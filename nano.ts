// Learn TypeScript:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/typescript.html
// Learn Attribute:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/reference/attributes.html
// Learn life-cycle callbacks:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/life-cycle-callbacks.html

import Message from "./message";
import Package from "./package";
import Protocol from "./protocol";

const { ccclass, property } = cc._decorator;

@ccclass
export default class nano extends cc.EventTarget {

  constructor() {
    super();

    this.handlers[Package.TYPE_HANDSHAKE] = this.handshake;
    this.handlers[Package.TYPE_HEARTBEAT] = this.heartbeat;
    this.handlers[Package.TYPE_DATA] = this.onData;
    this.handlers[Package.TYPE_KICK] = this.onKick;
  }
  static JS_WS_CLIENT_TYPE = 'js-websocket';
  static JS_WS_CLIENT_VERSION = '0.0.1';

  decodeIO_encoder = null;
  decodeIO_decoder = null;
  rsa = null;

  static RES_OK = 200;
  static RES_FAIL = 500;
  static RES_OLD_CLIENT = 501;

  socket = null;
  reqId = 0;
  callbacks = {};
  handlers = {};
  //Map from request id to route
  routeMap = {};
  dict = {};    // route string to code
  abbrs = {};   // code to route string

  heartbeatInterval = 0;
  heartbeatTimeout = 0;
  nextHeartbeatTimeout = 0;
  gapThreshold = 100;   // heartbeat gap threashold
  heartbeatId = null;
  heartbeatTimeoutId = null;
  handshakeCallback = null;

  decode = null;
  encode = null;

  reconnect = false;
  reconncetTimer = null;
  reconnectUrl = null;
  reconnectAttempts = 0;
  reconnectionDelay = 5000;
  static DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

  useCrypto;

  handshakeBuffer = {
    'sys': {
      type: nano.JS_WS_CLIENT_TYPE,
      version: nano.JS_WS_CLIENT_VERSION,
      rsa: {}
    },
    'user': {
    }
  }

  initCallback = null;

  init(params, cb) {
    this.initCallback = cb;
    var host = params.host;
    var port = params.port;
    var path = params.path;

    this.encode = params.encode || this.defaultEncode;
    this.decode = params.decode || this.defaultDecode;

    var url = 'ws://' + host;
    if (port) {
      url += ':' + port;
    }

    if (path) {
      url += path;
    }

    this.handshakeBuffer.user = params.user;
    if (params.encrypt) {
      this.useCrypto = true;
      this.rsa.generate(1024, "10001");
      var data = {
        rsa_n: this.rsa.n.toString(16),
        rsa_e: this.rsa.e
      };
      this.handshakeBuffer.sys.rsa = data;
    }
    this.handshakeCallback = params.handshakeCallback;
    this.connect(params, url, cb);
  }

  defaultDecode(data) {
    var msg = Message.decode(data);

    if (msg.id > 0) {
      msg.route = this.routeMap[msg.id];
      delete this.routeMap[msg.id];
      if (!msg.route) {
        return;
      }
    }

    msg.body = this.deCompose(msg);
    return msg;
  }

  defaultEncode(reqId, route, msg) {
    var type = reqId ? Message.TYPE_REQUEST : Message.TYPE_NOTIFY;

    if (this.decodeIO_encoder && this.decodeIO_encoder.lookup(route)) {
      var Builder = this.decodeIO_encoder.build(route);
      msg = new Builder(msg).encodeNB();
    } else {
      msg = Protocol.strencode(JSON.stringify(msg));
    }

    var compressRoute = 0;
    if (this.dict && this.dict[route]) {
      route = this.dict[route];
      compressRoute = 1;
    }

    return Message.encode(reqId, type, compressRoute, route, msg);
  }

  connect(params, url, cb) {
    console.log('connect to ' + url);

    var params = params || {};
    var maxReconnectAttempts = params.maxReconnectAttempts || nano.DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.reconnectUrl = url;

    var onopen = (event) => {
      if (!!this.reconnect) {
        this.emit('reconnect');
      }
      this.reset();
      var obj = Package.encode(Package.TYPE_HANDSHAKE, Protocol.strencode(JSON.stringify(this.handshakeBuffer)));
      this.send(obj);
    };
    var onmessage = (event) => {
      this.processPackage(Package.decode(event.data));
      // new package arrived, update the heartbeat timeout
      if (this.heartbeatTimeout) {
        this.nextHeartbeatTimeout = Date.now() + this.heartbeatTimeout;
      }
    };
    var onerror = (event) => {
      this.emit('io-error', event);
      console.error('socket error: ', event);
    };
    var onclose = (event) => {
      this.emit('close', event);
      this.emit('disconnect', event);
      console.log('socket close: ', event);
      if (!!params.reconnect && this.reconnectAttempts < maxReconnectAttempts) {
        this.reconnect = true;
        this.reconnectAttempts++;
        this.reconncetTimer = setTimeout(() => {
          this.connect(params, this.reconnectUrl, cb);
        }, this.reconnectionDelay);
        this.reconnectionDelay *= 2;
      }
    };
    this.socket = new WebSocket(url);
    this.socket.binaryType = 'arraybuffer';
    this.socket.onopen = onopen;
    this.socket.onmessage = onmessage;
    this.socket.onerror = onerror;
    this.socket.onclose = onclose;
  }

  disconnect() {
    if (this.socket) {
      if (this.socket.disconnect) this.socket.disconnect();
      if (this.socket.close) this.socket.close();
      console.log('disconnect');
      this.socket = null;
    }

    if (this.heartbeatId) {
      clearTimeout(this.heartbeatId);
      this.heartbeatId = null;
    }
    if (this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = null;
    }
  }

  reset() {
    this.reconnect = false;
    this.reconnectionDelay = 1000 * 5;
    this.reconnectAttempts = 0;
    clearTimeout(this.reconncetTimer);
  }

  request(route, msg, cb) {
    if (arguments.length === 2 && typeof msg === 'function') {
      cb = msg;
      msg = {};
    } else {
      msg = msg || {};
    }
    route = route || msg.route;
    if (!route) {
      return;
    }

    this.reqId++;
    this.sendMessage(this.reqId, route, msg);

    this.callbacks[this.reqId] = cb;
    this.routeMap[this.reqId] = route;
  }

  notify(route, msg) {
    msg = msg || {};
    this.sendMessage(0, route, msg);
  }

  sendMessage(reqId, route, msg) {
    if (this.useCrypto) {
      msg = JSON.stringify(msg);
      var sig = this.rsa.signString(msg, "sha256");
      msg = JSON.parse(msg);
      msg['__crypto__'] = sig;
    }

    if (this.encode) {
      msg = this.encode(reqId, route, msg);
    }

    var packet = Package.encode(Package.TYPE_DATA, msg);
    this.send(packet);
  }

  send(packet) {
    this.socket.send(packet.buffer);
  }

  handler = {};

  heartbeat(data) {
    if (!this.heartbeatInterval) {
      // no heartbeat
      return;
    }

    var obj = Package.encode(Package.TYPE_HEARTBEAT);
    if (this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = null;
    }

    if (this.heartbeatId) {
      // already in a heartbeat interval
      return;
    }
    this.heartbeatId = setTimeout(() => {
      this.heartbeatId = null;
      this.send(obj);

      this.nextHeartbeatTimeout = Date.now() + this.heartbeatTimeout;
      this.heartbeatTimeoutId = setTimeout(this.heartbeatTimeoutCb, this.heartbeatTimeout);
    }, this.heartbeatInterval);
  }

  heartbeatTimeoutCb() {
    var gap = this.nextHeartbeatTimeout - Date.now();
    if (gap > this.gapThreshold) {
      this.heartbeatTimeoutId = setTimeout(this.heartbeatTimeoutCb, gap);
    } else {
      console.error('server heartbeat timeout');
      this.emit('heartbeat timeout');
      this.disconnect();
    }
  }

  handshake(data) {
    data = JSON.parse(Protocol.strdecode(data));
    if (data.code === nano.RES_OLD_CLIENT) {
      this.emit('error', 'client version not fullfill');
      return;
    }

    if (data.code !== nano.RES_OK) {
      this.emit('error', 'handshake fail');
      return;
    }

    this.handshakeInit(data);

    var obj = Package.encode(Package.TYPE_HANDSHAKE_ACK);
    this.send(obj);
    if (this.initCallback) {
      this.initCallback(this.socket);
    }
  }

  onData(data) {
    var msg = data;
    if (this.decode) {
      msg = this.decode(msg);
    }
    this.processMessage(nano, msg);
  }

  onKick(data) {
    data = JSON.parse(Protocol.strdecode(data));
    this.emit('onKick', data);
  }



  processPackage(msgs) {
    if (Array.isArray(msgs)) {
      for (var i = 0; i < msgs.length; i++) {
        var msg = msgs[i];
        this.handlers[msg.type].apply(this,[msg.body]);
      }
    } else {
      
      this.handlers[msgs.type].apply(this,[msgs.body]);
    }
  }

  processMessage(nano, msg) {
    if (!msg.id) {
      // server push message
      nano.emit(msg.route, msg.body);
      return;
    }

    //if have a id then find the callback function with the request
    var cb = this.callbacks[msg.id];

    delete this.callbacks[msg.id];
    if (typeof cb !== 'function') {
      return;
    }

    cb(msg.body);

  }

  processMessageBatch(nano, msgs) {
    for (var i = 0, l = msgs.length; i < l; i++) {
      this.processMessage(nano, msgs[i]);
    }
  }

  deCompose(msg) {
    var route = msg.route;

    //Decompose route from dict
    if (msg.compressRoute) {
      if (!this.abbrs[route]) {
        return {};
      }

      route = msg.route = this.abbrs[route];
    }

    if (this.decodeIO_decoder && this.decodeIO_decoder.lookup(route)) {
      return this.decodeIO_decoder.build(route).decode(msg.body);
    } else {
      return JSON.parse(Protocol.strdecode(msg.body));
    }

    return msg;
  }

  handshakeInit(data) {
    if (data.sys && data.sys.heartbeat) {
      this.heartbeatInterval = data.sys.heartbeat * 1000;   // heartbeat interval
      this.heartbeatTimeout = this.heartbeatInterval * 2;        // max heartbeat timeout
    } else {
      this.heartbeatInterval = 0;
      this.heartbeatTimeout = 0;
    }

    this.initData(data);

    if (typeof this.handshakeCallback === 'function') {
      this.handshakeCallback(data.user);
    }
  }

  //Initilize data used in nano client
  initData(data) {
    if (!data || !data.sys) {
      return;
    }
    let dict = data.sys.dict;

    //Init compress dict
    if (dict) {
      this.dict = dict;
      this.abbrs = {};

      for (var route in dict) {
        this.abbrs[dict[route]] = route;
      }
    }
  }
}
