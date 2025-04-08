from flask import Blueprint, request, jsonify

def create_blueprint():
    """Create and return the blueprint to avoid circular imports"""
    ntfy_bp = Blueprint('ntfy', __name__)
    
    @ntfy_bp.route('/api/ntfy/configs', methods=['GET'])
    def get_ntfy_configs():
        from core.extranotifs.ntfy.db import get_configs_from_db
        configs = get_configs_from_db()
        return jsonify({"success": True, "configs": configs})
    
    @ntfy_bp.route('/api/ntfy/config/<int:config_id>', methods=['GET'])
    def get_ntfy_config(config_id):
        from core.extranotifs.ntfy.db import get_config_by_id
        config = get_config_by_id(config_id)
        if config:
            return jsonify({"success": True, "config": config})
        return jsonify({"success": False, "message": "Configuration not found"}), 404
    
    @ntfy_bp.route('/api/ntfy/config', methods=['POST'])
    def save_ntfy_config():
        from core.extranotifs.ntfy.db import save_config
        config_data = request.json
        result = save_config(config_data)
        return jsonify(result)
    
    @ntfy_bp.route('/api/ntfy/config/<int:config_id>', methods=['DELETE'])
    def delete_ntfy_config(config_id):
        from core.extranotifs.ntfy.db import delete_config
        result = delete_config(config_id)
        return jsonify(result)
    
    @ntfy_bp.route('/api/ntfy/config/<int:config_id>/default', methods=['POST'])
    def set_default_ntfy_config(config_id):
        from core.extranotifs.ntfy.db import set_default_config
        result = set_default_config(config_id)
        return jsonify(result)
    
    @ntfy_bp.route('/api/ntfy/test', methods=['POST'])
    def test_ntfy():
        from core.extranotifs.ntfy.ntfy import test_notification
        config_data = request.json
        result = test_notification(config_data)
        return jsonify(result)
    
    @ntfy_bp.route('/api/ntfy/test/<int:config_id>', methods=['POST'])
    def test_ntfy_config(config_id):
        from core.extranotifs.ntfy.db import get_config_by_id
        from core.extranotifs.ntfy.ntfy import test_notification
        
        event_type = request.args.get('event_type')
        config = get_config_by_id(config_id)
        
        if not config:
            return jsonify({"success": False, "message": "Configuration not found"}), 404
        
        result = test_notification(config, event_type)
        return jsonify(result)
    
    @ntfy_bp.route('/api/ntfy/settings', methods=['GET'])
    def get_ntfy_settings():
        from core.extranotifs.ntfy.db import get_notification_settings
        settings = get_notification_settings()
        return jsonify({"success": True, "settings": settings})
    
    @ntfy_bp.route('/api/ntfy/setting', methods=['POST'])
    def save_ntfy_setting():
        from core.extranotifs.ntfy.db import save_notification_setting
        setting_data = request.json
        
        # Debug log to see what's being received
        print(f"Received notification setting data: {setting_data}")
        
        result = save_notification_setting(setting_data)
        return jsonify(result)
    
    return ntfy_bp 