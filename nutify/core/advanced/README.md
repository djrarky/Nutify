# Advanced NUT Configuration Module

This module provides functionality to manage NUT (Network UPS Tools) configuration files directly from the Nutify web interface.

## Features

- Read and modify NUT configuration files located in `/etc/nut/`
- Interactive editor with syntax highlighting
- Documentation panel showing available options for each configuration file
- Restart NUT services after making changes

## Supported Configuration Files

The module supports the following NUT configuration files:

- **nut.conf**: Main NUT configuration file that determines the mode of operation.
- **ups.conf**: Configuration file for UPS devices.
- **upsd.conf**: Configuration file for the NUT server daemon.
- **upsd.users**: User access control for NUT server.
- **upsmon.conf**: Configuration file for UPS monitoring daemon.

## Implementation Details

### Backend

- `advanced.py`: Core functionality to read and write configuration files
- `api_advanced.py`: API endpoints for the advanced module
- `routes_advanced.py`: HTML routes (for consistency with module structure)

### Frontend

- `advanced_options.js`: JavaScript functionality for the Advanced tab
- Added to the options page in `options.html`

## API Endpoints

- `GET /api/advanced/nut/files`: Get a list of available NUT configuration files
- `GET /api/advanced/nut/config/<filename>`: Get the content of a specific configuration file
- `POST /api/advanced/nut/config/<filename>`: Update a configuration file
- `POST /api/advanced/nut/restart`: Restart NUT services
- `GET /api/advanced/nut/docs/<filename>`: Get documentation for a specific configuration file

## Requirements

- CodeMirror for the editor functionality
  - Core CodeMirror library
  - Shell mode for syntax highlighting
  - Monokai theme for better visibility

## Note

This module requires appropriate permissions to read and write files in `/etc/nut/` and to restart NUT services. The application should be run with sufficient privileges or via a user that has access to these resources. 