# nano client in typescript

## Description
nano typescript client SDK for cocos creator, which cocos creator is using socket.io.
generally it would be doing great in other js/ts project.
no dependecies required.

## Integrated into cocos creator
drag these ts files into your assets/ in cocos creator or other ts project.


## Usage
```typescript
import nano from "./nano/nano";


const {ccclass, property} = cc._decorator;

@ccclass
export default class Server {
    static s:nano;
    public static init(host:string, port:number){
        Server.s = new nano();
        Server.s.init({
            host:host,
            port:port,
            reconnect:true
        },()=>{
            console.log("server connected...")
        })
    }
    
    public static listen(route, callback){
        Server.s.on(route, ()=>{
            callback();
        })
    }

    public static request(route, msg, callback:Function){
        Server.s.request(route,msg,(response)=>{
            if(response.code == 200){
                callback(response)
            }else{
                console.log("response error:",response)
            }
        })
    }
    public static nofity(route, msg){
        Server.s.notify(route,msg)
    }
    public static disconnect(){
        Server.s.disconnect();
    }
}
```

## Comments
Due to nano needed to emmit events, so i extended nano with cc.EventTarget.
So you need to instantiate the nano class for usage.
All is good for now.


## Progress
* [x] connect
* [x] handshake
* [x] send request via json 
* [x] response

## Issues
Any issues and pr's are welcomed.
