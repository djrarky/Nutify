from datetime import datetime, timedelta
import pytz
from flask import Blueprint, render_template, redirect, url_for, request, jsonify, flash, abort
from core.logger import report_logger as logger
from core.settings import get_configured_timezone
from core.report.report import report_manager
from core.db.ups import db, data_lock, ReportSchedule
from core.mail import get_current_email_settings

routes_report = Blueprint('routes_report', __name__)

@routes_report.route('/reports')
def reports_page():
    """Render the reports page"""
    try:
        # Get all schedules
        schedules = report_manager.get_schedules()
        
        # Get email settings to check if email is enabled
        email_config = get_current_email_settings()
        email_enabled = email_config and email_config.get('enabled', False)
        
        # Render the page
        return render_template(
            'reports.html',
            schedules=schedules,
            email_enabled=email_enabled
        )
    except Exception as e:
        logger.error(f"Error rendering reports page: {str(e)}", exc_info=True)
        flash('An error occurred loading the reports page.', 'danger')
        return redirect(url_for('index'))

@routes_report.route('/reports/new')
def new_report_page():
    """Render the new report page"""
    try:
        # Check if email is enabled
        email_config = get_current_email_settings()
        email_enabled = email_config and email_config.get('enabled', False)
        
        if not email_enabled:
            flash('Email service must be enabled to create report schedules.', 'warning')
            return redirect(url_for('routes_report.reports_page'))
        
        # Render the page
        return render_template('report_new.html')
    except Exception as e:
        logger.error(f"Error rendering new report page: {str(e)}", exc_info=True)
        flash('An error occurred loading the new report page.', 'danger')
        return redirect(url_for('routes_report.reports_page'))

@routes_report.route('/reports/edit/<int:schedule_id>')
def edit_report_page(schedule_id):
    """Render the edit report page"""
    try:
        # Get all schedules
        schedules = report_manager.get_schedules()
        
        # Find the specified schedule
        schedule = next((s for s in schedules if s['id'] == schedule_id), None)
        
        if not schedule:
            flash('Report schedule not found.', 'danger')
            return redirect(url_for('routes_report.reports_page'))
        
        # Check if email is enabled
        email_config = get_current_email_settings()
        email_enabled = email_config and email_config.get('enabled', False)
        
        if not email_enabled:
            flash('Email service must be enabled to edit report schedules.', 'warning')
            return redirect(url_for('routes_report.reports_page'))
        
        # Render the page
        return render_template('report_edit.html', schedule=schedule)
    except Exception as e:
        logger.error(f"Error rendering edit report page: {str(e)}", exc_info=True)
        flash('An error occurred loading the edit report page.', 'danger')
        return redirect(url_for('routes_report.reports_page'))

@routes_report.route('/reports/generate')
def generate_report_page():
    """Render the generate report page"""
    try:
        # Get current timezone
        tz = get_configured_timezone()
        
        # Default to last 24 hours if no dates provided
        now = datetime.now(tz)
        yesterday = now - timedelta(days=1)
        
        # Format dates for the date picker
        default_from_date = yesterday.strftime('%Y-%m-%d %H:%M')
        default_to_date = now.strftime('%Y-%m-%d %H:%M')
        
        # Render the page
        return render_template(
            'report_generate.html',
            default_from_date=default_from_date,
            default_to_date=default_to_date
        )
    except Exception as e:
        logger.error(f"Error rendering generate report page: {str(e)}", exc_info=True)
        flash('An error occurred loading the generate report page.', 'danger')
        return redirect(url_for('routes_report.reports_page'))

@routes_report.route('/reports/view')
def view_report():
    """Generate and display a report based on query parameters"""
    try:
        # Get date parameters from query string
        from_date_str = request.args.get('from_date')
        to_date_str = request.args.get('to_date')
        report_type = request.args.get('report_type', 'custom')
        
        if not from_date_str or not to_date_str:
            flash('From date and to date are required to generate a report.', 'danger')
            return redirect(url_for('routes_report.generate_report_page'))
        
        # Parse dates
        try:
            tz = get_configured_timezone()
            
            # Try to parse with timezone first
            try:
                from_date = datetime.fromisoformat(from_date_str.replace('Z', '+00:00'))
            except ValueError:
                # If that fails, try to parse local format and attach timezone
                from_date = datetime.strptime(from_date_str, '%Y-%m-%d %H:%M')
                from_date = tz.localize(from_date)
            
            try:
                to_date = datetime.fromisoformat(to_date_str.replace('Z', '+00:00'))
            except ValueError:
                # If that fails, try to parse local format and attach timezone
                to_date = datetime.strptime(to_date_str, '%Y-%m-%d %H:%M')
                to_date = tz.localize(to_date)
            
        except ValueError as e:
            flash(f'Invalid date format: {str(e)}', 'danger')
            return redirect(url_for('routes_report.generate_report_page'))
        
        # Generate the report
        result = report_manager.generate_report(from_date, to_date, report_type)
        
        if result.get('status') == 'success':
            # Return the HTML report directly
            return result.get('html')
        else:
            flash(result.get('message', 'Failed to generate report'), 'danger')
            return redirect(url_for('routes_report.generate_report_page'))
            
    except Exception as e:
        logger.error(f"Error viewing report: {str(e)}", exc_info=True)
        flash(f'An error occurred generating the report: {str(e)}', 'danger')
        return redirect(url_for('routes_report.generate_report_page')) 