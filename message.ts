// Learn TypeScript:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/typescript.html
// Learn Attribute:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/reference/attributes.html
// Learn life-cycle callbacks:
//  - https://docs.cocos.com/creator/2.4/manual/en/scripting/life-cycle-callbacks.html

import Protocol from "./protocol";

const { ccclass, property } = cc._decorator;



@ccclass
export default class Message {
    static TYPE_REQUEST = 0;
    static TYPE_NOTIFY = 1;
    static TYPE_RESPONSE = 2;
    static TYPE_PUSH = 3;
    /**
     * Message protocol encode.
     *
     * @param  {Number} id            message id
     * @param  {Number} type          message type
     * @param  {Number} compressRoute whether compress route
     * @param  {Number|String} route  route code or route string
     * @param  {Buffer} msg           message body bytes
     * @return {Buffer}               encode result
     */
    static encode(id, type, compressRoute, route, msg) {
        // caculate message max length
        var idBytes = Protocol.msgHasId(type) ? Protocol.caculateMsgIdBytes(id) : 0;
        var msgLen = Protocol.MSG_FLAG_BYTES + idBytes;

        if (Protocol.msgHasRoute(type)) {
            if (compressRoute) {
                if (typeof route !== 'number') {
                    throw new Error('error flag for number route!');
                }
                msgLen += Protocol.MSG_ROUTE_CODE_BYTES;
            } else {
                msgLen += Protocol.MSG_ROUTE_LEN_BYTES;
                if (route) {
                    route = Protocol.strencode(route);
                    if (route.length > 255) {
                        throw new Error('route maxlength is overflow');
                    }
                    msgLen += route.length;
                }
            }
        }

        if (msg) {
            msgLen += msg.length;
        }

        var buffer = new Uint8Array(msgLen);
        var offset = 0;

        // add flag
        offset = Protocol.encodeMsgFlag(type, compressRoute, buffer, offset);

        // add message id
        if (Protocol.msgHasId(type)) {
            offset = Protocol.encodeMsgId(id, buffer, offset);
        }

        // add route
        if (Protocol.msgHasRoute(type)) {
            offset = Protocol.encodeMsgRoute(compressRoute, route, buffer, offset);
        }

        // add body
        if (msg) {
            offset = Protocol.encodeMsgBody(msg, buffer, offset);
        }

        return buffer;
    };

    /**
     * Message protocol decode.
     *
     * @param  {Buffer|Uint8Array} buffer message bytes
     * @return {Object}            message object
     */
    static decode(buffer) {
        var bytes = new Uint8Array(buffer);
        var bytesLen = bytes.length;
        var offset = 0;
        var id = 0;
        var route = null;

        // parse flag
        var flag = bytes[offset++];
        var compressRoute = flag & Protocol.MSG_COMPRESS_ROUTE_MASK;
        var type = (flag >> 1) & Protocol.MSG_TYPE_MASK;

        // parse id
        if (Protocol.msgHasId(type)) {
            var m = (bytes[offset]);
            var i = 0;
            do {
                var m = (bytes[offset]);
                id = id + ((m & 0x7f) * Math.pow(2, (7 * i)));
                offset++;
                i++;
            } while (m >= 128);
        }

        // parse route
        if (Protocol.msgHasRoute(type)) {
            if (compressRoute) {
                route = (bytes[offset++]) << 8 | bytes[offset++];
            } else {
                var routeLen = bytes[offset++];
                if (routeLen) {
                    route = new Uint8Array(routeLen);
                    Protocol.copyArray(route, 0, bytes, offset, routeLen);
                    route = Protocol.strdecode(route);
                } else {
                    route = '';
                }
                offset += routeLen;
            }
        }

        // parse body
        var bodyLen = bytesLen - offset;
        var body = new Uint8Array(bodyLen);

        Protocol.copyArray(body, 0, bytes, offset, bodyLen);

        return {
            'id': id, 'type': type, 'compressRoute': compressRoute,
            'route': route, 'body': body
        };
    };
}
