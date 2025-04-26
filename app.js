// app.js
import dotenv from 'dotenv';
import StreamrDrive from './streamr-drive.js';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['STREAMR_PRIVATE_KEY', 'STREAMR_STREAM_ID'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  console.error('Please create a .env file with these variables.');
  process.exit(1);
}

// Create and initialize StreamrDrive
const streamrDrive = new StreamrDrive({
  storageDir: process.env.STORAGE_DIR || './storage',
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Caught interrupt signal');
  await streamrDrive.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Caught termination signal');
  await streamrDrive.shutdown();
  process.exit(0);
});

// Start the application
(async () => {
  try {
    await streamrDrive.initialize();
    console.log('StreamrDrive is ready!');
  } catch (error) {
    console.error('Failed to initialize StreamrDrive:', error);
    process.exit(1);
  }
})();