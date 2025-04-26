# StreamrDrive

A Google Drive-like file manager for any device that uses Streamr Network for connectivity. This application allows you to remotely manage files on your device from any other device that can connect to the Streamr Network.

## Features

- List files and directories
- Upload files to the device
- Download files from the device
- Delete files or directories
- Create directories
- Get file information
- Handles large files through chunking (using streamr-chunker)

## Requirements

- Any device that can run Node.js
- Node.js v14+ (with ES modules support)
- Streamr Network account and private key
- streamr-client
- streamr-chunker

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/streamr-drive.git
   cd streamr-drive
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file with your Streamr credentials:
   ```
   STREAMR_PRIVATE_KEY=your_private_key_here
   STREAMR_STREAM_ID=your_stream_id_here
   STORAGE_DIR=./storage
   ```

## Running the Application

Start the application:

```
node app.js
```

The application will start and connect to the Streamr Network. It will create the storage directory if it doesn't exist.

## Client Commands

You can interact with StreamrDrive by sending JSON messages to the Streamr stream. Here are the available commands:

### List Files

```json
{
  "action": "list",
  "path": "directory/path" // Optional, defaults to root
}
```

### Upload File

```json
{
  "action": "upload",
  "fileName": "example.txt",
  "path": "directory/path", // Optional, defaults to root
  "data": "base64_encoded_file_data"
}
```

### Download File

```json
{
  "action": "download",
  "fileName": "example.txt",
  "path": "directory/path" // Optional, defaults to root
}
```

### Delete File or Directory

```json
{
  "action": "delete",
  "fileName": "example.txt",
  "path": "directory/path" // Optional, defaults to root
}
```

### Create Directory

```json
{
  "action": "mkdir",
  "dirName": "new_directory",
  "path": "parent/directory" // Optional, defaults to root
}
```

### Get File Info

```json
{
  "action": "info",
  "fileName": "example.txt",
  "path": "directory/path" // Optional, defaults to root
}
```

## Example Client

Here's an example of how to connect to StreamrDrive from a client application:

```javascript
import StreamrClient from 'streamr-client';
import { StreamrChunker } from 'streamr-chunker';

// Initialize Streamr client with your private key
const client = new StreamrClient({
  auth: { privateKey: 'your_private_key_here' }
});

// Get your stream URL
const streamId = 'your_stream_id_here';
const address = await client.getAddress();
const streamUrl = `${address}/${streamId}`;

// Initialize StreamrChunker
const chunker = new StreamrChunker()
  .withDeviceId('client-device-id')
  .withIgnoreOwnMessages()
  .withMaxMessageSize(64000);

// Set up message handlers
chunker.on('message', (message) => {
  console.log('Received message:', message);
  
  if (message.type === 'text') {
    try {
      const response = JSON.parse(message.body);
      console.log('Response:', response);
    } catch (error) {
      console.error('Error parsing response:', error);
    }
  } else if (message.type === 'file') {
    console.log(`Received file: ${message.fileName} (${message.fileSize} bytes)`);
    // Handle file download
    const buffer = Buffer.from(message.body, 'base64');
    // Save file or process it
  }
});

chunker.on('publish', async (message) => {
  await client.publish(streamUrl, message);
});

// Subscribe to stream
await client.subscribe(streamUrl, (message) => {
  chunker.receiveHandler(message);
});

// Example: List files
await client.publish(streamUrl, {
  type: 'text',
  body: JSON.stringify({
    action: 'list',
    path: ''
  }),
  deviceId: 'client-device-id'
});
```

## Security Considerations

This application uses Streamr Network's built-in security features. Access to your files is controlled by who has access to your Streamr stream. Make sure to keep your private keys secure and ensure that the stream permissions are configured as private in the Streamr Network.