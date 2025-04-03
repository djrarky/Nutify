#!/usr/bin/env python3
"""
Webhook Test Server

This script creates a simple HTTP server to receive and log webhook requests.
It sends proper HTTP responses, making it compatible with the webhook client.
"""

import http.server
import socketserver
import json
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('webhook-server')

# Server configuration
PORT = 5051
HOST = '0.0.0.0'  # Listen on all interfaces

class WebhookHandler(http.server.BaseHTTPRequestHandler):
    """Custom handler for webhook requests"""
    
    def _set_response(self, status_code=200, content_type='application/json'):
        """Set the response headers"""
        self.send_response(status_code)
        self.send_header('Content-type', content_type)
        self.end_headers()
    
    def do_POST(self):
        """Handle POST requests (webhooks)"""
        # Get request details
        content_length = int(self.headers['Content-Length']) if 'Content-Length' in self.headers else 0
        
        # Read and decode the request body
        post_data = self.rfile.read(content_length).decode('utf-8')
        
        # Log the request
        logger.info(f"Received webhook request to {self.path}")
        logger.info("Headers:")
        for header in self.headers:
            logger.info(f"  {header}: {self.headers[header]}")
        
        # Try to parse JSON
        try:
            json_data = json.loads(post_data)
            logger.info("JSON Payload:")
            for key, value in json_data.items():
                logger.info(f"  {key}: {value}")
        except json.JSONDecodeError:
            logger.info(f"Raw payload: {post_data}")
        
        # Log to file
        with open(f"webhook-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json", "w") as f:
            f.write(post_data)
        
        # Send a success response
        self._set_response()
        response = {
            "status": "success",
            "message": "Webhook received successfully",
            "timestamp": datetime.now().isoformat()
        }
        self.wfile.write(json.dumps(response).encode('utf-8'))
    
    def do_GET(self):
        """Handle GET requests (for testing connection)"""
        self._set_response()
        response = {
            "status": "online",
            "message": "Webhook server is running",
            "timestamp": datetime.now().isoformat()
        }
        self.wfile.write(json.dumps(response).encode('utf-8'))
    
    def log_message(self, format, *args):
        """Override the default log message method to use our logger"""
        logger.info(f"{self.client_address[0]} - {format % args}")

def run_server():
    """Run the webhook server"""
    with socketserver.TCPServer((HOST, PORT), WebhookHandler) as httpd:
        logger.info(f"Starting webhook server on {HOST}:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            logger.info("Stopping server...")
            httpd.server_close()
            logger.info("Server stopped")

if __name__ == "__main__":
    run_server()
