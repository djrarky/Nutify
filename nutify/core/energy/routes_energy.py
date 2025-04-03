from flask import render_template
from core.db.ups import get_ups_data
from core.settings import TIMEZONE
from core.logger import energy_logger as logger

# Import functions from energy module
from .energy import (
    get_energy_data
)

def register_routes(app):
    """Register all HTML routes for the energy section"""
    
    @app.route('/energy')
    def energy_page():
        """Render the dedicated energy cost page"""
        # Get real UPS data (DotDict object)
        ups_data = get_ups_data() or {}
        # Default data for energy statistics
        energy_stats = {
            'total_energy': 0.00,
            'total_cost': 0.00,
            'avg_load': 0.0,
            'co2': 0.00,
            'trends': {
                'energy': 0.0,
                'cost': 0.0,
                'load': 0.0,
                'co2': 0.0
            },
            'efficiency': {
                'peak': 0.0,
                'average': 0.0,
                'saved': 0.00
            }
        }
        # Merge energy data directly into ups_data so the template can access data.trends, data.total_energy, etc.
        ups_data.total_energy = energy_stats['total_energy']
        ups_data.total_cost = energy_stats['total_cost']
        ups_data.avg_load = energy_stats['avg_load']
        ups_data.co2 = energy_stats['co2']
        ups_data.trends = energy_stats['trends']
        ups_data.efficiency = energy_stats['efficiency']
        return render_template('dashboard/energy.html', data=ups_data, timezone=TIMEZONE)
        
    return app 