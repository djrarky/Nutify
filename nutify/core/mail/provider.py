"""
Email provider configurations module.
This module contains the configuration for various email providers.
"""

# Email provider configurations
email_providers = {
    'gmail': {
        'smtp_server': 'smtp.gmail.com',
        'smtp_port': 587,
        'tls': True,
        'tls_starttls': True,
        'auth': True,
        'notes': 'Requires app password if 2FA is enabled',
        'displayName': 'Gmail'
    },
    'outlook': {
        'smtp_server': 'smtp.office365.com',
        'smtp_port': 587,
        'tls': True,
        'tls_starttls': True,
        'auth': True,
        'notes': 'Requires app password if 2FA is enabled. Port 465 with SSL not officially supported.',
        'displayName': 'Outlook (Microsoft)'
    },
    'icloud': {
        'smtp_server': 'smtp.mail.me.com',
        'smtp_port': 587,
        'tls': True,
        'tls_starttls': True,
        'auth': True,
        'notes': 'Requires app-specific password if 2FA is enabled. Generate on appleid.apple.com.',
        'displayName': 'Apple iCloud Mail'
    },
    'yahoo': {
        'smtp_server': 'smtp.mail.yahoo.com',
        'smtp_port': 587,
        'tls': True,
        'tls_starttls': True,
        'auth': True,
        'notes': 'Requires app password if 2FA is enabled',
        'displayName': 'Yahoo Mail'
    },
    'aol': {
        'smtp_server': 'smtp.aol.com',
        'smtp_port': 587,
        'tls': True,
        'tls_starttls': True,
        'auth': True,
        'notes': 'Requires app password if 2FA is enabled',
        'displayName': 'AOL Mail'
    },
    'gmx': {
        'smtp_server': 'mail.gmx.com',
        'smtp_port': 587,
        'tls': True,
        'tls_starttls': True,
        'auth': True,
        'notes': 'Requires app password if 2FA is enabled',
        'displayName': 'GMX Mail'
    },
    'protonmail': {
        'smtp_server': 'smtp.protonmail.ch',
        'smtp_port': 587,
        'tls': True,
        'tls_starttls': True,
        'auth': True,
        'notes': 'Requires Bridge app or paid plan',
        'displayName': 'ProtonMail'
    },
    'amazon': {
        'smtp_server': 'email-smtp.us-east-1.amazonaws.com',
        'smtp_port': 587,
        'tls': True,
        'tls_starttls': True,
        'auth': True,
        'notes': 'AWS SES service. Generate SMTP credentials in AWS console.',
        'displayName': 'Amazon SES'
    },
    'sendgrid': {
        'smtp_server': 'smtp.sendgrid.net',
        'smtp_port': 587,
        'tls': True,
        'tls_starttls': True,
        'auth': True,
        'notes': 'Use "apikey" as username and your API key as password',
        'displayName': 'SendGrid'
    },
    'mailgun': {
        'smtp_server': 'smtp.mailgun.org',
        'smtp_port': 587,
        'tls': True,
        'tls_starttls': True,
        'auth': True,
        'notes': 'Use postmaster@yourdomain.com as username and API key as password',
        'displayName': 'Mailgun'
    },
    'postmark': {
        'smtp_server': 'smtp.postmarkapp.com',
        'smtp_port': 587,
        'tls': True,
        'tls_starttls': True,
        'auth': True,
        'notes': 'Use your API key as both username and password',
        'displayName': 'Postmark'
    },
    'zoho': {
        'smtp_server': 'smtp.zoho.com',
        'smtp_port': 587,
        'tls': True,
        'tls_starttls': True,
        'auth': True,
        'notes': 'Use app-specific password if 2FA is enabled',
        'displayName': 'Zoho Mail'
    }
}

def get_provider_config(provider_name):
    """
    Get the configuration for a specific email provider.
    
    Args:
        provider_name (str): The name of the provider
        
    Returns:
        dict: The provider configuration or None if not found
    """
    return email_providers.get(provider_name.lower())

def get_all_providers():
    """
    Get all available email providers.
    
    Returns:
        dict: All email providers configurations
    """
    return email_providers

def get_provider_list():
    """
    Get a list of all available provider names.
    
    Returns:
        list: List of provider names
    """
    return list(email_providers.keys())

def add_provider(name, config):
    """
    Add a new email provider configuration.
    
    Args:
        name (str): The name of the provider
        config (dict): The provider configuration
        
    Returns:
        bool: True if added successfully, False otherwise
    """
    if name.lower() in email_providers:
        return False
    
    # Validate required fields
    required_fields = ['smtp_server', 'smtp_port', 'tls', 'tls_starttls']
    if not all(field in config for field in required_fields):
        return False
    
    email_providers[name.lower()] = config
    return True

def update_provider(name, config):
    """
    Update an existing email provider configuration.
    
    Args:
        name (str): The name of the provider
        config (dict): The provider configuration
        
    Returns:
        bool: True if updated successfully, False otherwise
    """
    if name.lower() not in email_providers:
        return False
    
    email_providers[name.lower()].update(config)
    return True

def remove_provider(name):
    """
    Remove an email provider configuration.
    
    Args:
        name (str): The name of the provider
        
    Returns:
        bool: True if removed successfully, False otherwise
    """
    if name.lower() not in email_providers:
        return False
    
    del email_providers[name.lower()]
    return True 