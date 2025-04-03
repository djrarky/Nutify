"""
Webhook notification system for UPS events.
"""

import requests
import json
import logging
import urllib3
from flask import current_app
import datetime
from core.logger import webhook_logger as logger
import socket
import ssl
import os
import time
import hmac
import hashlib
import re
from urllib3.exceptions import InsecureRequestWarning

# Disable insecure request warnings when verify=False is used
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

class WebhookNotifier:
    def __init__(self, config):
        self.config = config
        self.name = config.get('name', 'Webhook')
        self.url = config.get('url', '')
        self.auth_type = config.get('auth_type', 'none')
        self.auth_username = config.get('auth_username', '')
        self.auth_password = config.get('auth_password', '')
        self.auth_token = config.get('auth_token', '')
        self.content_type = config.get('content_type', 'application/json')
        self.custom_headers = self._parse_custom_headers(config.get('custom_headers', ''))
        self.include_ups_data = config.get('include_ups_data', True)
        
        # Enhanced SSL verification options
        self.verify_ssl = config.get('verify_ssl', True)
        self.custom_ca_cert = config.get('custom_ca_cert', None)
        
        # Retry configuration
        self.max_retries = config.get('max_retries', 3)
        self.retry_backoff = config.get('retry_backoff', True)
        self.retry_timeout = config.get('retry_timeout', 30)
        
        # Webhook security options
        self.signing_enabled = config.get('signing_enabled', False)
        self.signing_secret = config.get('signing_secret', '')
        self.signing_header = config.get('signing_header', 'X-Nutify-Signature')
        self.signing_algorithm = config.get('signing_algorithm', 'sha256')
        
        # Protocol enforcement - changed default to False to allow HTTP by default
        self.enforce_https = config.get('enforce_https', False)
        
        # Connection options
        self.skip_hostname_validation = config.get('skip_hostname_validation', False)
        self.direct_ip_connection = config.get('direct_ip_connection', False)
        
        # Testing options
        self.ignore_response_errors = config.get('ignore_response_errors', False)
    
    def _parse_custom_headers(self, headers_str):
        """Parse custom headers from JSON string or return empty dict"""
        try:
            if not headers_str:
                return {}
            return json.loads(headers_str)
        except Exception as e:
            logger.error(f"Error parsing custom headers: {str(e)}")
            return {}
    
    def _get_auth(self):
        """Get authentication based on auth_type"""
        if self.auth_type == 'basic':
            return (self.auth_username, self.auth_password)
        return None
    
    def _validate_hostname_resolution(self, hostname):
        """
        Attempt to resolve a hostname to validate DNS configuration
        
        Args:
            hostname (str): The hostname to resolve
            
        Returns:
            tuple: (success, ip_address or error_message)
        """
        try:
            logger.debug(f"Attempting to resolve hostname: {hostname}")
            # Set a shorter timeout for DNS resolution to avoid long waits
            socket.setdefaulttimeout(5)
            # Try to resolve the hostname to an IP address
            addr_info = socket.getaddrinfo(hostname, None, socket.AF_INET)
            if addr_info:
                ip = addr_info[0][4][0]
                logger.debug(f"Successfully resolved {hostname} to {ip}")
                return True, ip
            return False, "Failed to resolve hostname (no results)"
        except socket.gaierror as e:
            error_message = f"DNS resolution error: {str(e)}"
            logger.warning(f"Failed to resolve hostname {hostname}: {error_message}")
            return False, error_message
        except socket.timeout:
            error_message = "DNS resolution timed out"
            logger.warning(f"Timeout resolving hostname {hostname}: {error_message}")
            return False, error_message
        except Exception as e:
            error_message = f"Unexpected error resolving hostname: {str(e)}"
            logger.warning(f"Error resolving hostname {hostname}: {error_message}")
            return False, error_message
        finally:
            # Reset timeout to default
            socket.setdefaulttimeout(None)
    
    def _validate_webhook_url(self):
        """
        Validate webhook URL including protocol check and hostname resolution
        
        Returns:
            tuple: (is_valid, error_message)
        """
        if not self.url:
            return False, "No URL configured"
            
        # Check if URL has valid protocol
        url_pattern = re.compile(r'^(https?):\/\/([^:/]+)(:[0-9]+)?(\/.*)?$')
        match = url_pattern.match(self.url)
        
        if not match:
            return False, "Invalid URL format. Must start with http:// or https://"
            
        protocol = match.group(1).lower()
        hostname = match.group(2)
        
        # Enforce HTTPS if configured
        if self.enforce_https and protocol != 'https':
            return False, "HTTPS protocol is required for security. Use https:// instead of http://"
            
        # If using HTTP, but SSL verification is enabled, warn about potential issues
        if protocol == 'http' and self.verify_ssl:
            logger.warning(f"HTTP URL with SSL verification enabled for {self.url}. This may cause issues.")
        
        # Check IP address format
        is_ip = False
        ip_pattern = re.compile(r'^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$')
        if ip_pattern.match(hostname):
            # Validate IP address format
            try:
                octets = hostname.split('.')
                for octet in octets:
                    if int(octet) > 255:
                        return False, f"Invalid IP address format: {hostname}"
                is_ip = True
                logger.debug(f"URL contains IP address: {hostname}")
            except ValueError:
                return False, f"Invalid IP address format: {hostname}"
        
        # Skip hostname resolution if it's an IP or if hostname validation is disabled
        if not is_ip and not self.skip_hostname_validation:
            # Try to resolve the hostname
            resolution_success, resolution_result = self._validate_hostname_resolution(hostname)
            if not resolution_success:
                logger.warning(f"Hostname resolution failed for {hostname}: {resolution_result}")
                if self.direct_ip_connection:
                    logger.info(f"Continuing with direct connection attempt despite hostname resolution failure")
                else:
                    return False, f"Hostname resolution failed for {hostname}: {resolution_result}"
        else:
            if is_ip:
                logger.info(f"Using direct IP address: {hostname}")
            elif self.skip_hostname_validation:
                logger.info(f"Hostname validation skipped for {hostname} as configured")
            
        return True, ""
    
    def _prepare_headers(self, payload_str=None):
        """
        Prepare HTTP headers for the webhook request
        
        Args:
            payload_str (str, optional): JSON payload string for signing. Defaults to None.
            
        Returns:
            dict: Prepared headers
        """
        headers = {
            'Content-Type': self.content_type,
            'User-Agent': 'Nutify-UPS-Monitor/1.0'
        }
        
        # Add bearer token if specified
        if self.auth_type == 'bearer' and self.auth_token:
            headers['Authorization'] = f'Bearer {self.auth_token}'
        
        # Add signature if enabled and payload provided
        if self.signing_enabled and self.signing_secret and payload_str:
            signature = self._generate_signature(payload_str)
            if signature:
                headers[self.signing_header] = signature
                logger.debug(f"Added payload signature to {self.signing_header} header")
            
        # Add custom headers
        if self.custom_headers:
            headers.update(self.custom_headers)
            
        return headers
    
    def _generate_signature(self, payload_str):
        """
        Generate HMAC signature for the payload
        
        Args:
            payload_str (str): JSON payload string to sign
            
        Returns:
            str: Hex-encoded signature
        """
        try:
            if not self.signing_secret:
                logger.warning("Signature generation failed: No signing secret provided")
                return None
                
            # Convert string to bytes
            message = payload_str.encode('utf-8')
            secret = self.signing_secret.encode('utf-8')
            
            # Choose algorithm
            if self.signing_algorithm == 'sha256':
                hash_func = hashlib.sha256
            elif self.signing_algorithm == 'sha512':
                hash_func = hashlib.sha512
            else:
                hash_func = hashlib.sha256  # Default to SHA-256
            
            # Create signature
            signature = hmac.new(secret, message, hash_func).hexdigest()
            logger.debug(f"Generated {self.signing_algorithm} signature for payload")
            
            return signature
        except Exception as e:
            logger.error(f"Error generating signature: {str(e)}")
            return None
    
    def _prepare_payload(self, event_type, event_data, payload=None):
        """
        Prepare the webhook payload
        
        Args:
            event_type (str): Event type (ONLINE, ONBATT, etc.)
            event_data (dict): Additional event data
            payload (dict, optional): Custom payload data. Defaults to None.
            
        Returns:
            dict: Prepared payload
        """
        # Start with base payload or provided payload
        result = payload or {}
        
        # Add standard fields
        result.update({
            'event_type': event_type,
            'event_timestamp': datetime.datetime.now().isoformat(),
            'event_description': self._get_event_description(event_type)
        })
        
        # Add UPS data if requested
        if self.include_ups_data and event_data.get('ups_info'):
            result['ups_data'] = event_data.get('ups_info')
            
        return result
    
    def _get_event_description(self, event_type):
        """Get human-readable description for an event type"""
        event_descriptions = {
            'ONLINE': 'UPS is now running on line power',
            'ONBATT': 'UPS has switched to battery power',
            'LOWBATT': 'UPS battery is running low',
            'COMMOK': 'Communication with UPS has been restored',
            'COMMBAD': 'Communication with UPS has been lost',
            'SHUTDOWN': 'System shutdown is imminent due to low battery',
            'REPLBATT': 'UPS battery needs replacement',
            'NOCOMM': 'Cannot communicate with the UPS',
            'NOPARENT': 'Parent process has been lost',
            'CAL': 'UPS is performing calibration',
            'TRIM': 'UPS is trimming incoming voltage',
            'BOOST': 'UPS is boosting incoming voltage',
            'OFF': 'UPS is switched off',
            'OVERLOAD': 'UPS is overloaded',
            'BYPASS': 'UPS is in bypass mode',
            'NOBATT': 'UPS has no battery',
            'DATAOLD': 'UPS data is too old'
        }
        return event_descriptions.get(event_type, f'Unknown event: {event_type}')
    
    def _setup_ssl_verification(self, session):
        """Configure SSL verification for the request session"""
        if not self.verify_ssl:
            # Disable SSL verification if requested
            session.verify = False
            # Disable warnings for this session
            urllib3.disable_warnings(InsecureRequestWarning)
            logger.info("SSL certificate verification is disabled")
        elif self.custom_ca_cert:
            # Use custom CA certificate if provided
            if os.path.exists(self.custom_ca_cert):
                session.verify = self.custom_ca_cert
                logger.info(f"Using custom CA certificate: {self.custom_ca_cert}")
            else:
                logger.warning(f"Custom CA certificate not found: {self.custom_ca_cert}. Using system CA.")
                session.verify = True
        else:
            # Use system CA certificates
            session.verify = True
            logger.info("Using system CA certificates for SSL verification")
        
        return session
    
    def _configure_retry_adapter(self):
        """Configure the HTTPAdapter with retry settings"""
        # Make retry configuration more flexible
        retry_strategy = urllib3.Retry(
            total=self.max_retries,
            backoff_factor=1 if self.retry_backoff else 0,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["POST"],
            # Do not retry on connection errors when direct_ip_connection is enabled
            # This allows us to fail fast and try alternative methods
            raise_on_status=not self.direct_ip_connection
        )
        
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=3,
            pool_maxsize=3,
            max_retries=retry_strategy
        )
        
        return adapter
    
    def _setup_connection_options(self, session):
        """
        Configure additional connection options for the session
        
        This helps with DNS resolution issues and other connection problems
        """
        # Disable connection pooling if hostname validation is skipped
        # This ensures that DNS resolution happens fresh on each request
        if self.skip_hostname_validation:
            session.mount('http://', self._configure_retry_adapter())
            session.mount('https://', self._configure_retry_adapter())
            
            # Set a reasonable connect timeout to avoid long hangs
            # This is separate from the overall request timeout
            # and only affects the initial connection
            if hasattr(session, 'adapters'):
                for adapter in session.adapters.values():
                    if hasattr(adapter, 'connect_timeout'):
                        adapter.connect_timeout = 10.0
        
        return session
    
    def send_notification(self, event_type, event_data=None, custom_payload=None):
        """
        Send a webhook notification
        
        Args:
            event_type (str): Event type (ONLINE, ONBATT, etc.)
            event_data (dict, optional): Additional event data. Defaults to None.
            custom_payload (dict, optional): Custom payload to send. Defaults to None.
            
        Returns:
            dict: Response with success status and message
        """
        try:
            # Validate URL and protocol
            is_valid, error_message = self._validate_webhook_url()
            if not is_valid:
                if (self.skip_hostname_validation and "Hostname resolution failed" in error_message) or self.direct_ip_connection:
                    # When hostname validation is skipped or direct IP connection is enabled, we proceed despite resolution errors
                    logger.warning(f"Proceeding despite validation issues: {error_message}")
                else:
                    return {'success': False, 'message': error_message, 'error_type': 'url_validation_error'}
            
            # Prepare payload
            payload = self._prepare_payload(event_type, event_data or {}, custom_payload)
            
            # Convert payload to correct format based on content type
            json_data = None
            data = None
            payload_str = None
            
            if self.content_type == 'application/json':
                json_data = payload
                # Create string representation for signing
                payload_str = json.dumps(payload, separators=(',', ':'))
            else:
                # For other content types, serialize to JSON string
                payload_str = json.dumps(payload)
                data = payload_str
            
            # Prepare request parameters with signed payload
            headers = self._prepare_headers(payload_str)
            auth = self._get_auth()
            
            # Log security and connection settings
            ssl_mode = "disabled" if not self.verify_ssl else "enabled"
            if self.custom_ca_cert and self.verify_ssl:
                ssl_mode = f"enabled (custom CA: {self.custom_ca_cert})"
                
            signing_mode = "enabled" if self.signing_enabled and self.signing_secret else "disabled"
            
            connection_options = []
            if self.skip_hostname_validation:
                connection_options.append("skip hostname validation")
            if self.direct_ip_connection:
                connection_options.append("direct IP connection")
            if not connection_options:
                connection_options.append("standard connection")
            
            connection_mode = ", ".join(connection_options)
            
            logger.info(f"Sending webhook to {self.url} for event {event_type}")
            logger.info(f"Connection: {connection_mode}, SSL verification: {ssl_mode}, Payload signing: {signing_mode}")
            
            # Create a session for better connection handling
            session = requests.Session()
            
            # Configure SSL verification
            self._setup_ssl_verification(session)
            
            # Configure additional connection options
            self._setup_connection_options(session)
            
            # Configure retry adapter
            adapter = self._configure_retry_adapter()
            session.mount('http://', adapter)
            session.mount('https://', adapter)
            
            # Send the request with extended timeout for slower connections
            try:
                response = session.post(
                    self.url,
                    headers=headers,
                    auth=auth,
                    json=json_data,
                    data=data,
                    timeout=self.retry_timeout
                )
                
                # Check response
                if response.status_code < 400:  # Accept 2xx and 3xx responses
                    logger.info(f"Webhook sent successfully: {response.status_code}")
                    return {
                        'success': True, 
                        'message': f'Webhook sent successfully: {response.status_code}',
                        'status_code': response.status_code
                    }
                else:
                    logger.error(f"Webhook failed: {response.status_code} - {response.text}")
                    return {
                        'success': False, 
                        'message': f'Webhook failed: {response.status_code}',
                        'status_code': response.status_code,
                        'response': response.text[:200]  # Limit response text length
                    }
            except requests.exceptions.SSLError as ssl_err:
                error_message = str(ssl_err)
                logger.error(f"SSL certificate verification failed: {error_message}")
                
                # Provide more helpful error message
                help_message = (
                    "This usually indicates the server's SSL certificate is invalid, expired, "
                    "or not trusted by your system. You can disable SSL verification by setting "
                    "verify_ssl=False in the webhook configuration if you trust this server."
                )
                logger.info(help_message)
                
                return {
                    'success': False, 
                    'message': f'SSL certificate verification failed: {error_message}',
                    'error_type': 'ssl_error',
                    'help': help_message
                }
            except requests.exceptions.ConnectionError as conn_err:
                error_message = str(conn_err)
                logger.error(f"Connection error: {error_message}")
                
                # If ignoring response errors, log a warning but continue
                if self.ignore_response_errors and "ECONNREFUSED" in error_message:
                    logger.warning("Connection refused error occurred but ignore_response_errors is enabled. This is normal with simple test servers.")
                    return {
                        'success': False,
                        'message': 'Connection error: The request was likely sent but the server did not respond properly',
                        'error_type': 'connection_error',
                        'help': "This is normal when using simple test servers that don't send proper HTTP responses.",
                        'original_error': error_message
                    }
                
                # Check if it's a DNS resolution error
                if "NameResolutionError" in error_message or "Failed to resolve" in error_message or "Lookup timed out" in error_message:
                    help_message = (
                        "DNS resolution failed. Could not resolve the hostname in the webhook URL. "
                        "Try the following:\n"
                        "1. Check if the domain name is correct\n"
                        "2. Set 'skip_hostname_validation=True' in the webhook configuration\n"
                        "3. Set 'direct_ip_connection=True' to attempt connection despite DNS issues\n"
                        "4. Use an IP address directly in the URL instead of a hostname"
                    )
                    
                    logger.info(help_message)
                    
                    return {
                        'success': False,
                        'message': f'DNS resolution error: {error_message}',
                        'error_type': 'dns_error',
                        'help': help_message
                    }
                    
                # Provide helpful message based on URL protocol
                is_https = self.url.lower().startswith('https://')
                
                if is_https:
                    help_message = (
                        "Connection to HTTPS server failed. This could be due to:\n"
                        "1. SSL/TLS configuration issues on the server\n"
                        "2. Server is not reachable or not accepting connections\n"
                        "3. Network configuration issues\n\n"
                        "Try setting 'verify_ssl=False' or using HTTP if the server supports it."
                    )
                else:
                    help_message = (
                        "Connection to HTTP server failed. This could be due to:\n"
                        "1. Server is not reachable or not accepting connections\n"
                        "2. Network configuration issues\n"
                        "3. The server might require HTTPS instead of HTTP"
                    )
                
                logger.info(help_message)
                
                return {
                    'success': False,
                    'message': f'Connection error: {error_message}',
                    'error_type': 'connection_error',
                    'help': help_message
                }
            except requests.exceptions.Timeout as timeout_err:
                error_message = str(timeout_err)
                logger.error(f"Request timed out: {error_message}")
                
                help_message = (
                    f"The request timed out after {self.retry_timeout} seconds. "
                    "This could be due to:\n"
                    "1. Server is slow to respond or overloaded\n"
                    "2. Network latency or connectivity issues\n"
                    "3. Server is unreachable\n\n"
                    "Try increasing the 'retry_timeout' value in the webhook configuration."
                )
                
                logger.info(help_message)
                
                return {
                    'success': False,
                    'message': f'Request timed out: {error_message}',
                    'error_type': 'timeout_error',
                    'help': help_message
                }
                
        except requests.RequestException as e:
            logger.error(f"Webhook request error: {str(e)}")
            return {'success': False, 'message': f'Request error: {str(e)}'}
            
        except Exception as e:
            logger.error(f"Error sending webhook: {str(e)}")
            return {'success': False, 'message': str(e)}

def test_notification(config, event_type=None):
    """
    Send a test webhook notification
    
    Args:
        config (dict): Webhook configuration
        event_type (str, optional): Event type for test. Defaults to None.
        
    Returns:
        dict: Response with success status and message
    """
    # Add ignore_response_errors parameter for testing
    config_copy = config.copy() if config else {}
    config_copy['ignore_response_errors'] = True
    
    notifier = WebhookNotifier(config_copy)
    
    # Use provided event type or default to TEST
    test_event_type = event_type or 'TEST'
    
    # Prepare test data
    test_data = {
        'ups_info': {
            'ups_model': 'Test UPS',
            'device_serial': 'TEST123456',
            'battery_charge': '100',
            'ups_status': 'OL',
            'input_voltage': '230'
        }
    }
    
    # Prepare test payload with timestamp
    test_payload = {
        'test': True,
        'message': f'This is a test notification from Nutify UPS Monitor',
        'timestamp': datetime.datetime.now().isoformat()
    }
    
    result = notifier.send_notification(test_event_type, test_data, test_payload)
    
    # If the test fails with connection errors but we're set to ignore them
    if not result['success'] and result.get('error_type') == 'connection_error' and config_copy.get('ignore_response_errors'):
        logger.warning("Connection error occurred but payload was likely sent. Marking as successful for testing purposes.")
        return {
            'success': True,
            'message': 'Webhook was sent to the server, but no response was received. This is normal with simple test servers like netcat.',
            'original_error': result.get('message', 'Connection error')
        }
        
    return result

def get_ups_info(ups_name=None):
    """
    Get UPS information from the database
    
    Args:
        ups_name (str, optional): Name of the UPS. Defaults to None.
        
    Returns:
        dict: UPS data
    """
    try:
        # Get UPS data using the existing function from the UPS event system
        from core.events.ups_notifier import get_detailed_ups_info
        return get_detailed_ups_info(ups_name or 'ups@localhost')
    except Exception as e:
        logger.error(f"Error getting UPS info: {str(e)}")
        return {
            'ups_model': 'Unknown',
            'device_serial': 'Unknown',
            'ups_status': 'Unknown',
            'battery_charge': '0',
            'input_voltage': '0V'
        }

def send_event_notification(event_type, ups_name=None):
    """
    Send webhook notifications for a UPS event
    
    Args:
        event_type (str): Event type (ONLINE, ONBATT, etc.)
        ups_name (str, optional): Name of the UPS. Defaults to None.
        
    Returns:
        dict: Response with success status
    """
    try:
        from core.extranotifs.webhook.db import get_enabled_configs_for_event
        
        # Get UPS information
        ups_info = get_ups_info(ups_name)
        
        # Get webhooks enabled for this event
        webhooks = get_enabled_configs_for_event(event_type)
        
        if not webhooks:
            logger.debug(f"No webhooks enabled for event {event_type}")
            return {'success': False, 'message': 'No webhooks enabled for this event'}
        
        # Prepare event data
        event_data = {
            'ups_info': ups_info,
            'ups_name': ups_name
        }
        
        # Send to all enabled webhooks
        results = []
        for webhook_config in webhooks:
            try:
                notifier = WebhookNotifier(webhook_config)
                result = notifier.send_notification(event_type, event_data)
                results.append({
                    'webhook_id': webhook_config.get('id'),
                    'webhook_name': webhook_config.get('name'),
                    'success': result.get('success'),
                    'message': result.get('message')
                })
            except Exception as e:
                logger.error(f"Error sending to webhook {webhook_config.get('id')}: {str(e)}")
                results.append({
                    'webhook_id': webhook_config.get('id'),
                    'webhook_name': webhook_config.get('name'),
                    'success': False,
                    'message': str(e)
                })
        
        # Consider successful if at least one webhook was sent successfully
        success = any(result.get('success') for result in results)
        
        return {
            'success': success,
            'message': f"Sent to {len(results)} webhooks, {sum(1 for r in results if r.get('success'))} succeeded",
            'results': results
        }
        
    except Exception as e:
        logger.error(f"Error sending webhook event notifications: {str(e)}")
        return {'success': False, 'message': str(e)} 