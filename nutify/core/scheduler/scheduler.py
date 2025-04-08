import schedule
import threading
import time
from datetime import datetime, timedelta, date
import pytz
from core.logger import get_logger
from core.settings import get_configured_timezone as settings_get_timezone, parse_time_format
from core.db.ups import db, ReportSchedule
from core.mail import get_current_email_settings, get_mail_config_model
from tenacity import retry, stop_after_attempt, wait_exponential
from typing import List, Optional
from flask import request, jsonify, current_app, has_app_context
import logging
import sqlite3
# from croniter import croniter  # Temporaneamente commentato fino all'installazione del pacchetto
from sqlalchemy import func

# Configure logging
scheduler_logger = logging.getLogger('scheduler')

# Global variable for ReportSchedule model
ReportSchedule = None

# Helper function to safely get the MailConfig model
def get_mail_config():
    """Safely get the MailConfig model"""
    MailConfig = get_mail_config_model()
    if MailConfig is None:
        scheduler_logger.error("❌ MailConfig model not available")
    return MailConfig

def register_report_schedule_model(model_class):
    """Register the ReportSchedule model class"""
    global ReportSchedule
    ReportSchedule = model_class
    scheduler_logger.info("✅ ReportSchedule model registered")
    return True

def register_db(db_instance):
    """Register the database instance"""
    global db
    db = db_instance
    scheduler_logger.info("✅ Database instance registered")
    return True

def get_configured_timezone():
    """Get the configured timezone from app config or default to UTC"""
    try:
        # First try getting from core.settings
        try:
            from core.settings import get_configured_timezone as settings_get_timezone
            return settings_get_timezone()
        except (ImportError, AttributeError) as e:
            scheduler_logger.warning(f"Could not get timezone from settings: {str(e)}")
            
        # If that fails, try getting from Flask app
        if has_app_context():
            tz_name = current_app.config.get('TIMEZONE', 'UTC')
            return pytz.timezone(tz_name)
        
        # If no timezone configured, default to UTC
        return pytz.UTC
    except Exception as e:
        scheduler_logger.error(f"❌ Error getting timezone: {str(e)}")
        # Default to UTC
        return pytz.UTC

def calculate_report_period(period_type):
    """Calculate start and end dates based on period type"""
    tz = get_configured_timezone()
    now = datetime.now(tz)
    
    if period_type == 'daily':
        # Last 24 hours
        start_date = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = now
        return start_date, end_date
    elif period_type == 'yesterday':
        # Full previous day (00:00 to 23:59)
        yesterday = now - timedelta(days=1)
        start_date = datetime(yesterday.year, yesterday.month, yesterday.day, 0, 0, 0, tzinfo=tz)
        end_date = datetime(yesterday.year, yesterday.month, yesterday.day, 23, 59, 59, tzinfo=tz)
        return start_date, end_date
    elif period_type == 'last_week':
        # Previous Monday to Sunday (fixed to avoid overlapping with current week)
        days_since_monday = now.weekday()  # 0 is Monday, 6 is Sunday
        # Go to the start of the current week (most recent Monday)
        start_of_this_week = (now - timedelta(days=days_since_monday)).replace(hour=0, minute=0, second=0, microsecond=0)
        # Go back 7 days to get to the start of last week (Monday)
        start_of_last_week = start_of_this_week - timedelta(days=7)
        # Last week ends at the end of Sunday (right before current week starts)
        end_of_last_week = start_of_this_week - timedelta(microseconds=1)
        return start_of_last_week, end_of_last_week
    elif period_type == 'last_month':
        # First day to last day of previous month
        first_day_of_this_month = datetime(now.year, now.month, 1, tzinfo=tz)
        last_day_of_last_month = first_day_of_this_month - timedelta(days=1)
        first_day_of_last_month = datetime(last_day_of_last_month.year, last_day_of_last_month.month, 1, tzinfo=tz)
        
        start_date = datetime(first_day_of_last_month.year, first_day_of_last_month.month, first_day_of_last_month.day, 0, 0, 0, tzinfo=tz)
        end_date = datetime(last_day_of_last_month.year, last_day_of_last_month.month, last_day_of_last_month.day, 23, 59, 59, tzinfo=tz)
        return start_date, end_date
    elif period_type == 'range':
        # For custom range, dates will be passed separately
        return None, None
    elif period_type == 'weekly':
        # Last 7 days
        start_date = (now - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = now
        return start_date, end_date
    elif period_type == 'monthly':
        # Last 30 days
        start_date = (now - timedelta(days=30)).replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = now
        return start_date, end_date
    elif period_type == 'yearly':
        # Last 365 days
        start_date = (now - timedelta(days=365)).replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = now
        return start_date, end_date
    else:
        # Default to daily
        start_date = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = now
        return start_date, end_date

class Scheduler:
    def __init__(self, app=None):
        """Initialize the scheduler"""
        self.app = app
        self.tz = get_configured_timezone()
        self.scheduler_lock = threading.Lock()
        self.last_schedule_id = None
        self.report_manager = None
        self._initialized = False
        self._thread = None
        if app:
            self.init_app(app)
        scheduler_logger.info("📅 Scheduler instance created")

    def init_app(self, app):
        """Initialize scheduler with Flask app"""
        try:
            self.app = app
            scheduler_logger.info("📅 Initializing Scheduler")
            
            # Import report_manager here to avoid circular import
            from core.report import report_manager
            self.report_manager = report_manager
            
            with app.app_context():
                # Check if ReportSchedule is available and properly initialized
                if ReportSchedule is None:
                    scheduler_logger.error("❌ ReportSchedule model is not available. Scheduler cannot be initialized.")
                    scheduler_logger.error("   This is likely because database initialization did not properly register models.")
                    scheduler_logger.error("   The application will continue without scheduled reports.")
                    return
                
                try:
                    # Verify model is properly initialized by testing a simple query
                    test_query = db.session.query(ReportSchedule).limit(1)
                    test_query.all()  # Execute query to verify it works
                    scheduler_logger.info("✅ ReportSchedule model verified to be working")
                except Exception as model_error:
                    scheduler_logger.error(f"❌ ReportSchedule model is available but not properly initialized: {str(model_error)}")
                    scheduler_logger.error("   The application will continue without scheduled reports.")
                    return
                
                # Load active schedules from database
                try:
                    schedules = ReportSchedule.query.filter_by(enabled=True).all()
                    scheduler_logger.info(f"Found {len(schedules)} enabled schedules")
                    
                    # Add jobs using schedule library
                    for sched_item in schedules:
                        self._add_job_from_schedule(sched_item)
                    
                    # Start scheduler thread
                    self.start_scheduler()
                    
                    # Mark scheduler as successfully initialized
                    self._initialized = True
                    scheduler_logger.info("✅ Scheduler successfully initialized")
                except Exception as e:
                    scheduler_logger.error(f"❌ Error loading schedules: {str(e)}")
                
        except Exception as e:
            scheduler_logger.error(f"❌ Error in init_app: {str(e)}", exc_info=True)

    def _add_job_from_schedule(self, schedule_item):
        """Add a job to the scheduler based on schedule configuration"""
        if not self.app or not self.report_manager:
            scheduler_logger.error("❌ Cannot add job: Scheduler not properly initialized")
            return False
        
        try:
            # Create job ID
            job_id = f"report_{schedule_item.id}"
            
            # Remove job if it exists
            self._remove_job(job_id)
            
            # Create job function
            def job_function():
                try:
                    with self.app.app_context():
                        scheduler_logger.info(f"⏰ Running scheduled report: {schedule_item.name if hasattr(schedule_item, 'name') else f'Schedule {schedule_item.id}'}")
                        # Get fresh data from DB in case it was updated
                        current_schedule = ReportSchedule.query.get(schedule_item.id)
                        if current_schedule and current_schedule.enabled:
                            # Calculate period for report
                            start_date, end_date = calculate_report_period(current_schedule.period_type)
                            
                            # Ensure the mail_config_id is valid
                            if not current_schedule.mail_config_id:
                                scheduler_logger.error(f"❌ Schedule {current_schedule.id} has no mail_config_id, cannot send report")
                                return
                                
                            scheduler_logger.info(f"Using mail_config_id: {current_schedule.mail_config_id}")
                            
                            # Run report generation
                            self.report_manager.generate_and_send_report(
                                report_types=current_schedule.reports.split(','),
                                email=None,  # We're using mail_config_id instead
                                from_date=start_date,
                                to_date=end_date,
                                period_type=current_schedule.period_type,
                                id_email=current_schedule.mail_config_id,  # Pass the mail_config_id
                                scheduled=True,
                                schedule_id=current_schedule.id
                            )
                        else:
                            scheduler_logger.warning(f"⚠️ Schedule {job_id} is disabled or deleted, skipping execution")
                except Exception as e:
                    scheduler_logger.error(f"❌ Error executing scheduled job {job_id}: {str(e)}")
            
            # Schedule based on cron expression
            if hasattr(schedule_item, 'cron_expression') and schedule_item.cron_expression:
                cron_parts = schedule_item.cron_expression.split()
                if len(cron_parts) == 5:
                    minute, hour, day, month, day_of_week = cron_parts
                    
                    # Configure job based on cron parts
                    if minute != "*":
                        for m in minute.split(','):
                            schedule.every().day.at(f"{hour.zfill(2)}:{m.zfill(2)}").do(job_function).tag(job_id)
                    else:
                        # For complex schedules, use a more generic approach
                        schedule.every().minute.do(
                            lambda: self._should_run_job(
                                minute, hour, day, month, day_of_week, job_function
                            )
                        ).tag(job_id)
                    
                    scheduler_logger.info(f"✅ Added job {job_id} with cron: {schedule_item.cron_expression}")
                    return True
                else:
                    scheduler_logger.error(f"❌ Invalid cron expression for schedule {schedule_item.id}")
                    return False
            else:
                # Legacy format using time and days
                time_str = schedule_item.time
                days_str = schedule_item.days
                
                if days_str == "*" or days_str == "":
                    # Schedule daily job
                    schedule.every().day.at(time_str).do(job_function).tag(job_id)
                    scheduler_logger.info(f"✅ Added daily job {job_id} at {time_str}")
                else:
                    # Schedule for specific days
                    day_mapping = {
                        0: "sunday", 1: "monday", 2: "tuesday",
                        3: "wednesday", 4: "thursday", 5: "friday",
                        6: "saturday"
                    }
                    day_list = [int(d) for d in days_str.split(',') if d.strip().isdigit()]
                    for d in day_list:
                        if d in day_mapping:
                            getattr(schedule.every(), day_mapping[d]).at(time_str).do(job_function).tag(job_id)
                            scheduler_logger.info(f"✅ Added job {job_id} for {day_mapping[d]} at {time_str}")
                return True
        except Exception as e:
            scheduler_logger.error(f"❌ Error adding job {schedule_item.id}: {str(e)}")
            return False

    def _should_run_job(self, minute, hour, day, month, day_of_week, job_function):
        """Check if job should run based on cron expression"""
        now = datetime.now()
        
        # Check if current time matches cron expression
        if self._match_cron(now.minute, minute) and \
           self._match_cron(now.hour, hour) and \
           self._match_cron(now.day, day) and \
           self._match_cron(now.month, month) and \
           self._match_cron(now.weekday(), day_of_week):
            job_function()
    
    def _match_cron(self, current, cron_part):
        """Check if current value matches cron part"""
        if cron_part == "*":
            return True
        
        # Handle comma-separated values
        if "," in cron_part:
            return str(current) in cron_part.split(",")
        
        # Handle ranges (e.g., "1-5")
        if "-" in cron_part:
            start, end = cron_part.split("-")
            return int(start) <= current <= int(end)
        
        # Handle step values (e.g., "*/5")
        if "/" in cron_part:
            _, step = cron_part.split("/")
            return current % int(step) == 0
        
        # Direct comparison
        return current == int(cron_part)
    
    def _remove_job(self, job_id):
        """Remove a job from the scheduler"""
        try:
            schedule.clear(job_id)
            scheduler_logger.info(f"✅ Removed job {job_id}")
            return True
        except Exception as e:
            scheduler_logger.error(f"❌ Error removing job {job_id}: {str(e)}")
            return False

    def start_scheduler(self):
        """Start the scheduler thread"""
        if not self._thread or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run_scheduler, daemon=True)
            self._thread.start()
            scheduler_logger.info("✅ Scheduler thread started")
        else:
            scheduler_logger.info("ℹ️ Scheduler thread already running")

    def _run_scheduler(self):
        """Run the scheduler loop"""
        scheduler_logger.info("🔄 Starting scheduler loop")
        try:
            while True:
                schedule.run_pending()
                time.sleep(1)
        except Exception as e:
            scheduler_logger.error(f"❌ Error in scheduler loop: {str(e)}")

    def clear_jobs_for_schedule(self, schedule_id):
        """Remove all jobs for a specific schedule"""
        try:
            scheduler_logger.info(f"Clearing jobs for schedule {schedule_id}")
            tag = f"schedule_{schedule_id}"
            schedule.clear(tag)
            scheduler_logger.info(f"Cleared jobs for schedule {schedule_id}")
            return True
        except Exception as e:
            scheduler_logger.error(f"Error clearing jobs: {str(e)}")
            return False

    def get_scheduled_jobs(self):
        """Get list of all scheduled jobs"""
        try:
            jobs = schedule.jobs
            scheduler_logger.info(f"Current scheduled jobs ({len(jobs)}):")
            for job in jobs:
                scheduler_logger.info(f"- {job}")
            return jobs
        except Exception as e:
            scheduler_logger.error(f"Error getting jobs: {str(e)}")
            return []

    def schedule_report(self, cron_expression, report_types, email, period_type='daily'):
        """
        Schedule a report to be generated and sent
        Args:
            cron_expression: Cron expression for scheduling
            report_types: List of report types
            email: Email address to send report to
            period_type: Period type (daily, weekly, monthly)
        """
        try:
            # Extract time if it's in HH:MM format
            if ":" in cron_expression and len(cron_expression.split()) == 1:
                # Simple time format, not full cron
                time_str = cron_expression
                days = "*"  # Every day
            else:
                # It's a cron expression, parse it
                cron_parts = cron_expression.split()
                if len(cron_parts) == 5:
                    minute, hour, day, month, day_of_week = cron_parts
                    time_str = f"{hour.zfill(2)}:{minute.zfill(2)}"
                    days = day_of_week
                else:
                    scheduler_logger.error(f"Invalid cron expression: {cron_expression}")
                    return False
            
            # Schedule the job
            job = schedule.every().day.at(time_str).do(
                self._wrapped_generate_report,
                report_types=report_types,
                email=email,
                period_type=period_type
            )
            
            # Store the job in the database
            self._save_schedule(time_str, days, report_types, email, period_type)
            
            # Add the job to the scheduler
            self.jobs.append(job)
            
            scheduler_logger.info(f"Scheduled report: {cron_expression}, types: {report_types}")
            return True
        except Exception as e:
            scheduler_logger.error(f"Error scheduling report: {str(e)}")
            return False

    def _execute_scheduled_report(self, schedule_id):
        """Execute a scheduled report"""
        try:
            with self.app.app_context():
                schedule_item = ReportSchedule.query.get(schedule_id)
                if not schedule_item or not schedule_item.enabled:
                    return

                # For 'range', use from_date and to_date from the schedule
                if schedule_item.period_type == 'range':
                    if not hasattr(schedule_item, 'from_date') or not hasattr(schedule_item, 'to_date'):
                        scheduler_logger.error(f"Schedule {schedule_id} has period_type 'range' but is missing from_date or to_date")
                        return
                    
                    if not schedule_item.from_date or not schedule_item.to_date:
                        scheduler_logger.error(f"Schedule {schedule_id} has period_type 'range' but from_date or to_date is None")
                        return
                    
                    # The dates are already in datetime format with timezone
                    from_date = schedule_item.from_date
                    to_date = schedule_item.to_date
                    
                    # Ensure dates have timezone
                    tz = get_configured_timezone()
                    if from_date.tzinfo is None:
                        from_date = tz.localize(from_date)
                    if to_date.tzinfo is None:
                        to_date = tz.localize(to_date)
                    
                    scheduler_logger.info(f"Range schedule: from {from_date} to {to_date}")
                else:
                    # For other types, use the existing function
                    from_date, to_date = calculate_report_period(schedule_item.period_type)
                    
                    # Ensure dates have timezone
                    tz = get_configured_timezone()
                    if from_date and from_date.tzinfo is None:
                        from_date = tz.localize(from_date)
                    if to_date and to_date.tzinfo is None:
                        to_date = tz.localize(to_date)

                scheduler_logger.info(f"📧 Sending scheduled report from {from_date} to {to_date}")
                scheduler_logger.info(f"Period type: {schedule_item.period_type}")
                
                # Verify mail_config_id exists
                if not schedule_item.mail_config_id:
                    scheduler_logger.error(f"❌ Schedule {schedule_id} has no mail_config_id, cannot send report")
                    return
                    
                scheduler_logger.info(f"Using mail_config_id: {schedule_item.mail_config_id}")

                success = self.report_manager.generate_and_send_report(
                    report_types=schedule_item.reports.split(','),
                    email=None,  # We're using mail_config_id instead
                    from_date=from_date,
                    to_date=to_date,
                    period_type=schedule_item.period_type,
                    id_email=schedule_item.mail_config_id,  # Pass the mail_config_id
                    scheduled=True,
                    schedule_id=schedule_id
                )

                if success:
                    scheduler_logger.info(f"Report sent successfully for schedule {schedule_id}")
                else:
                    scheduler_logger.error(f"Failed to send report for schedule {schedule_id}")

        except Exception as e:
            scheduler_logger.error(f"Error executing schedule {schedule_id}: {str(e)}")

    def is_initialized(self):
        """Check if the scheduler has been successfully initialized"""
        return self._initialized

    def find_lowest_available_id(self):
        """Find the lowest available ID for a new schedule"""
        if ReportSchedule is None:
            scheduler_logger.error("❌ Cannot find lowest ID: ReportSchedule model is not available")
            return None
            
        try:
            with self.app.app_context():
                # Get all existing IDs
                existing_ids = db.session.query(ReportSchedule.id).all()
                existing_ids = [item[0] for item in existing_ids]
                
                # If no schedules exist, start from ID 1
                if not existing_ids:
                    return 1
                
                # Find the lowest available ID
                for i in range(1, max(existing_ids) + 2):
                    if i not in existing_ids:
                        scheduler_logger.info(f"✅ Found lowest available ID: {i}")
                        return i
                        
                # Fallback to max + 1 (should never reach here)
                return max(existing_ids) + 1
        except Exception as e:
            scheduler_logger.error(f"❌ Error finding lowest available ID: {str(e)}")
            return None

    def add_schedule(self, schedule_data):
        """Add a new report schedule"""
        if ReportSchedule is None:
            scheduler_logger.error("❌ Cannot add schedule: ReportSchedule model is not available")
            return None
            
        try:
            with self.app.app_context():
                # Remove circular import
                # from core.scheduler.routes_scheduler import _all_schedules_deleted
                
                # Create new schedule (the routes_scheduler.py code now handles setting IDs)
                schedule = ReportSchedule(**schedule_data)
                db.session.add(schedule)
                db.session.commit()
                
                # Add job if schedule is enabled
                if schedule.enabled:
                    self._add_job_from_schedule(schedule)
                
                scheduler_logger.info(f"✅ Added new schedule with ID: {schedule.id}")
                return schedule
        except Exception as e:
            scheduler_logger.error(f"❌ Error adding schedule: {str(e)}")
            return None

    def update_schedule(self, schedule_id, schedule_data):
        """Update an existing report schedule"""
        if ReportSchedule is None:
            scheduler_logger.error("❌ Cannot update schedule: ReportSchedule model is not available")
            return None
            
        try:
            with self.app.app_context():
                # Get schedule
                schedule = ReportSchedule.query.get(schedule_id)
                if not schedule:
                    scheduler_logger.error(f"❌ Schedule with ID {schedule_id} not found")
                    return None
                
                # Remove existing job if it exists
                job_id = f"report_{schedule_id}"
                self._remove_job(job_id)
                
                # Update schedule fields
                for key, value in schedule_data.items():
                    setattr(schedule, key, value)
                
                db.session.commit()
                
                # Add job if schedule is enabled
                if schedule.enabled:
                    self._add_job_from_schedule(schedule)
                
                scheduler_logger.info(f"✅ Updated schedule: {schedule.name}")
                return schedule
        except Exception as e:
            scheduler_logger.error(f"❌ Error updating schedule: {str(e)}")
            return None

    def delete_schedule(self, schedule_id):
        """Delete a report schedule"""
        if ReportSchedule is None:
            scheduler_logger.error("❌ Cannot delete schedule: ReportSchedule model is not available")
            return False
            
        try:
            with self.app.app_context():
                # Get schedule
                schedule = ReportSchedule.query.get(schedule_id)
                if not schedule:
                    scheduler_logger.error(f"❌ Schedule with ID {schedule_id} not found")
                    return False
                
                # Remove job if it exists
                job_id = f"report_{schedule_id}"
                self._remove_job(job_id)
                
                # Delete schedule
                db.session.delete(schedule)
                db.session.commit()
                
                scheduler_logger.info(f"✅ Deleted schedule: {schedule.name}")
                return True
        except Exception as e:
            scheduler_logger.error(f"❌ Error deleting schedule: {str(e)}")
            return False

    def get_schedule(self, schedule_id):
        """Get a report schedule by ID"""
        if ReportSchedule is None:
            scheduler_logger.error("❌ Cannot get schedule: ReportSchedule model is not available")
            return None
            
        try:
            with self.app.app_context():
                schedule = ReportSchedule.query.get(schedule_id)
                if not schedule:
                    scheduler_logger.warning(f"Schedule with ID {schedule_id} not found")
                return schedule
        except Exception as e:
            scheduler_logger.error(f"❌ Error getting schedule: {str(e)}")
            return None

    def get_all_schedules(self):
        """Get all report schedules"""
        if ReportSchedule is None:
            scheduler_logger.error("❌ Cannot get schedules: ReportSchedule model is not available")
            return []
            
        try:
            with self.app.app_context():
                return ReportSchedule.query.all()
        except Exception as e:
            scheduler_logger.error(f"❌ Error getting all schedules: {str(e)}")
            return []

    def reload_schedules(self):
        """Reload all schedules from database"""
        if ReportSchedule is None:
            scheduler_logger.error("❌ Cannot reload schedules: ReportSchedule model is not available")
            return False
            
        try:
            with self.app.app_context():
                # Clear all jobs
                schedule.clear()
                
                # Load active schedules
                schedules = ReportSchedule.query.filter_by(enabled=True).all()
                scheduler_logger.info(f"Found {len(schedules)} enabled schedules")
                
                # Add jobs
                for sched_item in schedules:
                    self._add_job_from_schedule(sched_item)
                
                scheduler_logger.info("✅ Schedules reloaded successfully")
                return True
        except Exception as e:
            scheduler_logger.error(f"❌ Error reloading schedules: {str(e)}")
            return False

# Create scheduler instance
scheduler = Scheduler() 