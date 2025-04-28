// streamr-drive.js
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import StreamrClient from '@streamr/sdk';
import { StreamrChunker } from 'streamr-chunker';
import StreamrMessageController from './message-controller.js';
import { createHash } from 'crypto';
import os from 'os';

const TEMP_FOLDER_NAME = 'temp';

class StreamrDrive {
  constructor(config) {
    this.config = {
      storageDir: './storage',
      privateKey: process.env.STREAMR_PRIVATE_KEY,
      streamId: process.env.STREAMR_STREAM_ID,
      deviceId: this.generateDeviceId(),
      tempCleanupInterval: 24 * 60 * 60 * 1000, // 24 hours
      ...config
    };
    
    this.messageController = null;
    this.streamrClient = null;
    this.streamrChunker = null;
    this.streamUrl = null;
    this.tempCleanupTimer = null;
  }

  async initialize() {
    console.log('Initializing StreamrDrive...');
    
    // Ensure storage directory exists
    await fs.mkdir(this.config.storageDir, { recursive: true });
    
    // Initialize message controller
    await this.initializeMessageController();
    
    // Initialize Streamr client
    await this.initializeStreamrClient();
    
    // Setup temp folder cleanup
    await this.setupTempFolderCleanup();
    
    console.log(`StreamrDrive initialized and listening on stream: ${this.streamUrl}`);
    console.log(`Storage directory: ${this.config.storageDir}`);
    
    return this;
  }

  async initializeMessageController() {
    this.messageController = new StreamrMessageController({ 
      deviceId: this.config.deviceId 
    });
    
    await this.messageController.init();
    
    this.messageController.on("publish", (message) => {
      this.handleMessagePublish(message);
    });
    
    this.messageController.on("message", (message) => {
      this.processCommand(message);
    });
  }

  async initializeStreamrClient() {
    // Initialize Streamr client
    console.log("Initializing Streamr client...");
    this.streamrClient = new StreamrClient({
      auth: { privateKey: this.config.privateKey },
    });
    
    const address = await this.streamrClient.getAddress();
    this.streamUrl = `${address}/${this.config.streamId}`;
    console.log("Initialized");
    // Make sure stream exists and add to storage node
    const stream = await this.streamrClient.getStream(this.streamUrl);
    
    // Subscribe to stream
    await this.streamrClient.subscribe(this.streamUrl, (message) => {
      this.handleStreamrMessage(message);
    });
    console.log("Subscribed to stream");
    // Initialize StreamrChunker
    this.streamrChunker = new StreamrChunker()
      .withDeviceId(this.config.deviceId)
      .withIgnoreOwnMessages()
      .withMaxMessageSize(8*64000);
    
    this.streamrChunker.on("publish", (message) => {
      this.publishToStreamr(message);
    });
    
    this.streamrChunker.on("message", (message) => {
      this.handleChunkerMessage(message);
    });
    this.streamrChunker.on("chunk-update", (updateData) => {
      this.handleChunkUpdate(updateData);
    });
  }

  handleChunkUpdate(updateData) {
    try {
      // Loop through each message update in the array
      for (const update of updateData) {
        const { messageId, noOfChunks, lastChunkId, progress } = update;
        
        const total = lastChunkId + 1; // Since chunk IDs are zero-based
        
        const progressPercent = parseFloat(progress);
        const received = Math.round((progressPercent / 100) * total);
        
        if (received % 2 === 0 || received === total) {
          this.sendResponse({
            action: 'upload-progress',
            status: 'info',
            messageId,
            received,
            total,
            progress: progressPercent,
            complete: progressPercent === 100
          });
          
          console.log(`Upload progress: ${received}/${total} chunks (${progressPercent}%) for message ${messageId}`);
        }
      }
    } catch (error) {
      console.error('Error handling chunk update:', error);
    }
  }

  async handleMessagePublish(message) {
    try {
      this.streamrChunker.publish(message);
    } catch (error) {
      console.error('Error publishing message to chunker:', error);
    }
  }

  async publishToStreamr(message) {
    try {
      await this.streamrClient.publish(this.streamUrl, message);
    } catch (error) {
      console.error('Error publishing message to Streamr:', error);
    }
  }

  handleStreamrMessage(message) {
    try {
      this.streamrChunker.receiveHandler(message);
    } catch (error) {
      console.error('Error handling Streamr message:', error);
    }
  }

  handleChunkerMessage(message) {
    try {
      this.messageController.receiveHandler(message);
    } catch (error) {
      console.error('Error handling chunker message:', error);
    }
  }

  async processCommand(message) {
    if (message.type !== 'text') return;
    
    try {
      const command = JSON.parse(message.body);
      
      switch (command.action) {
        case 'ping':
          await this.handlePing(command);
          break;
        case 'list':
          await this.listFiles(command);
          break;
        case 'upload':
          await this.saveFile(command);
          break;
        case 'download':
          await this.downloadFile(command);
          break;
        case 'delete':
          await this.deleteFile(command);
          break;
        case 'mkdir':
          await this.createDirectory(command);
          break;
        case 'info':
          await this.getFileInfo(command);
          break;
        case 'rename':
          await this.renameFile(command);
          break;
        default:
          this.sendResponse({
            action: command.action,
            status: 'error',
            message: 'Unknown command'
          });
      }
    } catch (error) {
      console.error('Error processing command:', error);
      this.sendResponse({
        status: 'error',
        message: `Error processing command: ${error.message}`
      });
    }
  }

  async listFiles(command) {
    try {
      const dirPath = path.join(this.config.storageDir, command.path || '');
      
      // Check if directory exists
      try {
        await fs.access(dirPath);
      } catch (error) {
        return this.sendResponse({
          action: 'list',
          status: 'error',
          message: 'Directory not found'
        });
      }
      
      // Get directory contents
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      // Create file list with details
      const files = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const stats = await fs.stat(fullPath);
        
        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      }));
      
      this.sendResponse({
        action: 'list',
        status: 'success',
        path: command.path || '',
        files
      });
    } catch (error) {
      console.error('Error listing files:', error);
      this.sendResponse({
        action: 'list',
        status: 'error',
        message: `Error listing files: ${error.message}`
      });
    }
  }

  async saveFile(command) {
    try {
      if (!command.fileName || !command.data) {
        return this.sendResponse({
          action: 'upload',
          status: 'error',
          message: 'Missing fileName or data'
        });
      }
      
      const dirPath = path.join(this.config.storageDir, command.path || '');
      
      // Ensure directory exists
      await fs.mkdir(dirPath, { recursive: true });
      
      const filePath = path.join(dirPath, command.fileName);
      
      // Convert base64 data to buffer
      const buffer = Buffer.from(command.data, 'base64');
      
      // Write file
      await fs.writeFile(filePath, buffer);
      
      this.sendResponse({
        action: 'upload',
        status: 'success',
        fileName: command.fileName,
        path: command.path || '',
        size: buffer.length
      });
    } catch (error) {
      console.error('Error saving file:', error);
      this.sendResponse({
        action: 'upload',
        status: 'error',
        message: `Error saving file: ${error.message}`
      });
    }
  }

  async downloadFile(command) {
    try {
      if (!command.fileName) {
        return this.sendResponse({
          action: 'download',
          status: 'error',
          message: 'Missing fileName'
        });
      }
      
      const filePath = path.join(this.config.storageDir, command.path || '', command.fileName);
      
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        return this.sendResponse({
          action: 'download',
          status: 'error',
          message: 'File not found'
        });
      }
      
      // Read file
      const data = await fs.readFile(filePath);
      
      // Get file stats
      const stats = await fs.stat(filePath);
      
      // Send file through Streamr
      await this.messageController.upload({
        type: 'file',
        fileName: command.fileName,
        fileSize: stats.size,
        body: data.toString('base64')
      });
      
      this.sendResponse({
        action: 'download',
        status: 'success',
        fileName: command.fileName,
        path: command.path || '',
        size: stats.size
      });
    } catch (error) {
      console.error('Error downloading file:', error);
      this.sendResponse({
        action: 'download',
        status: 'error',
        message: `Error downloading file: ${error.message}`
      });
    }
  }

  async setupTempFolderCleanup() {    
    this.tempCleanupTimer = setInterval(() => {
      this.cleanupTempFolder().catch(err => {
        console.error('Error during scheduled temp folder cleanup:', err);
      });
    }, this.config.tempCleanupInterval);
  }

  async cleanupTempFolder() {
    const tempFolderPath = path.join(this.config.storageDir, TEMP_FOLDER_NAME);
    
    try {
      try {
        await fs.access(tempFolderPath);
      } catch (error) {
        // Temp folder doesn't exist
        return;
      }
      
      console.log('Cleaning up files in temp folder...');
      
      const entries = await fs.readdir(tempFolderPath, { withFileTypes: true });
      let deletedCount = 0;
      
      for (const entry of entries) {
        const entryPath = path.join(tempFolderPath, entry.name);
        
        if (entry.isDirectory()) {
          await fs.rm(entryPath, { recursive: true });
        } else {
          await fs.unlink(entryPath);
        }
        deletedCount++;
      }
      
      console.log(`Temp folder cleanup complete - removed ${deletedCount} items`);
    } catch (error) {
      console.error('Error during temp folder cleanup:', error);
    }
  }

  async deleteFile(command) {
    try {
      if (!command.fileName) {
        return this.sendResponse({
          action: 'delete',
          status: 'error',
          message: 'Missing fileName'
        });
      }
      
      const filePath = path.join(this.config.storageDir, command.path || '', command.fileName);
      
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        return this.sendResponse({
          action: 'delete',
          status: 'error',
          message: 'File not found'
        });
      }
      
      const stats = await fs.stat(filePath);
      
      if (stats.isDirectory()) {
        // Remove directory recursively
        await fs.rm(filePath, { recursive: true });
      } else {
        // Remove file
        await fs.unlink(filePath);
      }
      
      this.sendResponse({
        action: 'delete',
        status: 'success',
        fileName: command.fileName,
        path: command.path || ''
      });
    } catch (error) {
      console.error('Error deleting file:', error);
      this.sendResponse({
        action: 'delete',
        status: 'error',
        message: `Error deleting file: ${error.message}`
      });
    }
  }

  async createDirectory(command) {
    try {
      if (!command.dirName) {
        return this.sendResponse({
          action: 'mkdir',
          status: 'error',
          message: 'Missing dirName'
        });
      }
      
      const dirPath = path.join(this.config.storageDir, command.path || '', command.dirName);
      
      // Create directory
      await fs.mkdir(dirPath, { recursive: true });
      
      this.sendResponse({
        action: 'mkdir',
        status: 'success',
        dirName: command.dirName,
        path: command.path || ''
      });
    } catch (error) {
      console.error('Error creating directory:', error);
      this.sendResponse({
        action: 'mkdir',
        status: 'error',
        message: `Error creating directory: ${error.message}`
      });
    }
  }

  async getFileInfo(command) {
    try {
      if (!command.fileName) {
        return this.sendResponse({
          action: 'info',
          status: 'error',
          message: 'Missing fileName'
        });
      }
      
      const filePath = path.join(this.config.storageDir, command.path || '', command.fileName);
      
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        return this.sendResponse({
          action: 'info',
          status: 'error',
          message: 'File not found'
        });
      }
      
      // Get file stats
      const stats = await fs.stat(filePath);
      
      this.sendResponse({
        action: 'info',
        status: 'success',
        fileName: command.fileName,
        path: command.path || '',
        size: stats.size,
        isDirectory: stats.isDirectory(),
        created: stats.birthtime,
        modified: stats.mtime
      });
    } catch (error) {
      console.error('Error getting file info:', error);
      this.sendResponse({
        action: 'info',
        status: 'error',
        message: `Error getting file info: ${error.message}`
      });
    }
  }

  async handlePing(command) {
    try {
      this.sendResponse({
        action: 'pong',
        status: 'success',
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error handling ping:', error);
      this.sendResponse({
        action: 'ping',
        status: 'error',
        message: `Error handling ping: ${error.message}`
      });
    }
  }

  async renameFile(command) {
    try {
      if (!command.oldName || !command.newName) {
        return this.sendResponse({
          action: 'rename',
          status: 'error',
          message: 'Missing oldName or newName'
        });
      }
      
      const oldPath = path.join(this.config.storageDir, command.path || '', command.oldName);
      const newPath = path.join(this.config.storageDir, command.path || '', command.newName);
      
      // Check if source file/folder exists
      try {
        await fs.access(oldPath);
      } catch (error) {
        return this.sendResponse({
          action: 'rename',
          status: 'error',
          message: 'Source file/folder not found'
        });
      }
      
      // Check if destination already exists
      try {
        await fs.access(newPath);
        return this.sendResponse({
          action: 'rename',
          status: 'error',
          message: 'Destination already exists'
        });
      } catch (error) {
        // This is expected - destination should not exist
      }
      
      // Perform the rename operation
      await fs.rename(oldPath, newPath);
      
      // Get info about the renamed item
      const stats = await fs.stat(newPath);
      
      this.sendResponse({
        action: 'rename',
        status: 'success',
        oldName: command.oldName,
        newName: command.newName,
        path: command.path || '',
        isDirectory: stats.isDirectory(),
        size: stats.size
      });
    } catch (error) {
      console.error('Error renaming file/folder:', error);
      this.sendResponse({
        action: 'rename',
        status: 'error',
        message: `Error renaming file/folder: ${error.message}`
      });
    }
  }

  sendResponse(response) {
    this.messageController.upload({
      type: 'text',
      body: JSON.stringify(response)
    });
  }

  generateDeviceId() {
    const hostname = os.hostname();
    const hash = createHash('md5').update(hostname).digest('hex');
    return `streamr-drive-${hash.substring(0, 8)}`;
  }

  async shutdown() {
    console.log('Shutting down StreamrDrive...');
    
    if (this.tempCleanupTimer) {
      clearInterval(this.tempCleanupTimer);
      this.tempCleanupTimer = null;
    }
    
    if (this.messageController) {
      await this.messageController.destroy();
    }
    
    if (this.streamrClient) {
      await this.streamrClient.destroy();
    }
    
    console.log('StreamrDrive shut down successfully');
  }
}

export default StreamrDrive;