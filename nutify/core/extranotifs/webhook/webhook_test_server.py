#!/usr/bin/env python3
"""
Simple HTTP server for testing webhooks locally.
This server listens on port 8000 and logs all incoming requests.
"""

import http.server
import socketserver
import json
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("webhook_test_server")

# Define the request handler
class WebhookHandler(http.server.BaseHTTPRequestHandler):
    def _set_response(self):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        
    def do_GET(self):
        self._set_response()
        self.wfile.write(json.dumps({
            "message": "Webhook test server is running. Send POST requests to test webhooks."
        }).encode('utf-8'))
        logger.info(f"GET request received: {self.path}")
        
    def do_POST(self):
        # Get request information
        content_length = int(self.headers['Content-Length']) if 'Content-Length' in self.headers else 0
        post_data = self.rfile.read(content_length).decode('utf-8')
        
        # Log the request
        logger.info(f"POST request received: {self.path}")
        logger.info(f"Headers: {self.headers}")
        
        try:
            # Try to parse as JSON
            json_data = json.loads(post_data)
            logger.info(f"JSON data: {json.dumps(json_data, indent=2)}")
        except json.JSONDecodeError:
            # Not JSON, log as plain text
            logger.info(f"Post data: {post_data}")
        
        # Send response
        self._set_response()
        response = {
            "timestamp": datetime.now().isoformat(),
            "status": "success",
            "message": "Webhook received successfully"
        }
        self.wfile.write(json.dumps(response).encode('utf-8'))

def run_server(port=8000):
    server_address = ('', port)
    httpd = socketserver.TCPServer(server_address, WebhookHandler)
    logger.info(f"Starting webhook test server on port {port}")
    logger.info(f"Configure your webhook to point to: http://localhost:{port}/webhook")
    logger.info("Press Ctrl+C to stop the server")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    httpd.server_close()

if __name__ == "__main__":
    run_server() 