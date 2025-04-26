// message_controller.js
import EventEmitter from 'events';

const SUPPORTED_MESSAGE_TYPES = ["image", "text", "file"];

class StreamrMessageController extends EventEmitter {
  constructor(config) {
    super();
    this.deviceId = config.deviceId;
    this.receivedMessages = [];
    this.sentMessages = [];
  }
  
  async init() {
    return this;
  }
  
  destroy() {
    this.removeAllListeners();
    return Promise.resolve();
  }
  
  async receiveHandler(msg) {
    // console.log(`Message received: ${msg.type}`);
    this.receivedMessages.push(msg);
    this.emit("message", msg);
    
    if (msg.type === "image") this.emit("image", msg);
    if (msg.type === "text") this.emit("text", msg);
    if (msg.type === "file") this.emit("file", msg);
  }

  getLatestImage() {
    return this.getLatest("image");
  }
  
  getLatestText() {
    return this.getLatest("text");
  }
  
  getLatestFile() {
    return this.getLatest("file");
  }
  
  getLatestMessage() {
    return this.receivedMessages.length > 0 ? this.receivedMessages[this.receivedMessages.length - 1] : undefined;
  }
  
  getLatest(type) {
    const filtered = this.receivedMessages.filter((m) => m.type === type);
    return filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
  }
  
  async upload(msg) {
    if (!SUPPORTED_MESSAGE_TYPES.includes(msg.type)) {
      throw new Error("unknown content type");
    }
    
    this.sentMessages.unshift(msg);
    
    if (msg.type === "image") {
      await this.uploadImage(msg.body);
    } else if (msg.type === "text") {
      await this.uploadText(msg.body);
    } else if (msg.type === "file") {
      await this.uploadFile(msg);
    }
  }
  
  async uploadFile(msg) {
    try {
      const msgObj = {
        type: 'file',
        fileName: msg.fileName,
        fileSize: msg.fileSize,
        body: msg.body,
        deviceId: this.deviceId,
      };
      this.emit("publish", msgObj);
    } catch (err) {
      console.log("uploadFile error:", err);
      throw err;
    }
  }
  
  async uploadImage(base64image) {
    this.emit("publish", {
      type: 'image',
      body: base64image,
      deviceId: this.deviceId,
    });
  }
  
  async uploadText(text) {
    // console.log("uploading text: ", text.substring(0, 100) + (text.length > 100 ? '...' : ''));
    
    this.emit("publish", {
      type: 'text',
      body: text,
      deviceId: this.deviceId,
    });
  }
}

export default StreamrMessageController;