"""
UPS Data Cache Module.
This module provides a caching system for UPS data.
"""

import logging
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import threading
import json

from core.logger import database_logger as logger
from core.settings import CACHE_SECONDS
from core.db.ups.utils import get_configured_timezone
from core.db.ups.data import get_ups_data
from flask_socketio import SocketIO

# Lock for cache operations
data_lock = threading.Lock()

# WebSocket instance for cache updates
websocket = SocketIO()

class UPSDataCache:
    """
    UPS data caching system for efficient data storage and aggregation.
    
    This class provides:
    - Buffering of UPS data points
    - Calculation of averages and aggregates
    - Automatic saving with proper time alignment
    - Hourly and daily aggregations
    - Real-time WebSocket updates to clients
    """
    
    def __init__(self, size=5):
        """
        Initialize the cache with Pandas
        
        Args:
            size (int): Size of the buffer in seconds
        """
        self.size = size
        self.data = []
        self.df = None
        self.next_save_time = None
        self.next_hour = None  #  For tracking the next hour
        self.hourly_data = []  # Buffer for hourly data
        self.last_daily_aggregation = None
        # Last broadcasted cache data
        self.last_broadcast = None
        logger.info(f"📊 Initialized UPS data cache (size: {size} seconds)")

    def get_next_hour(self, current_time):
        """
        Calculate the exact next hour
        
        Args:
            current_time: Current timestamp
            
        Returns:
            datetime: Next hour timestamp
        """
        tz = get_configured_timezone()
        local_time = current_time.astimezone(tz)
        next_hour = local_time.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        return next_hour

    def calculate_hourly_average(self):
        """
        Calculate the hourly average of ups_realpower
        
        Returns:
            float: Hourly average or None if no data
        """
        if not self.hourly_data:
            return None
            
        df = pd.DataFrame(self.hourly_data)
        if 'ups_realpower' not in df.columns:
            return None
            
        return round(df['ups_realpower'].mean(), 2)

    def calculate_and_save_averages(self, db, UPSDynamicData, current_time):
        """
        Calculate averages and save to database if needed
        
        Args:
            db: Database instance
            UPSDynamicData: UPS dynamic data model class
            current_time: Current timestamp
            
        Returns:
            bool: True if data was saved, False otherwise
        """
        logger.debug(f"🕒 Current time: {current_time}")
        logger.debug(f"⏰ Next daily aggregation check: {self.last_daily_aggregation}")
        try:
            # Initialize next_hour if necessary
            if self.next_hour is None:
                self.next_hour = self.get_next_hour(current_time)

            # Check if it's time to save the normal data
            if not self.is_save_time(current_time):
                return False

            # Calculate averages using the existing code
            averages = self.calculate_averages()
            if not averages:
                return False

            logger.info(f"📊 Processing averages from {len(self.data)} samples at {self.next_save_time}")

            # Create a new record
            dynamic_data = UPSDynamicData()

            # Set only timestamp_tz
            dynamic_data.timestamp_tz = self.next_save_time

            # Check critical fields before setting values
            critical_fields = ['ups_status', 'ups_load', 'ups_realpower', 'ups_realpower_nominal']
            for field in critical_fields:
                if field in averages:
                    logger.info(f"Critical field {field} = {averages[field]} in averages")
                else:
                    logger.warning(f"Critical field {field} missing from averages")

            # Set the average values
            missing_keys = []
            for key, value in averages.items():
                if hasattr(dynamic_data, key):
                    setattr(dynamic_data, key, value)
                    if key in critical_fields:
                        logger.info(f"✅ Set critical field {key}={value} on UPSDynamicData")
                    else:
                        logger.debug(f"✅ Set {key}={value} on UPSDynamicData")
                else:
                    missing_keys.append(key)
                    logger.warning(f"⚠️ Key {key} not found in UPSDynamicData model")
            
            if missing_keys:
                logger.warning(f"⚠️ {len(missing_keys)} keys from averages were not in the model: {missing_keys[:5]}...")
                
            # Double-check critical fields after setting them
            for field in critical_fields:
                if hasattr(dynamic_data, field):
                    value = getattr(dynamic_data, field)
                    if value is None:
                        logger.warning(f"⚠️ Critical field '{field}' is None after setting")
                        if field in averages:
                            setattr(dynamic_data, field, averages[field])
                            logger.info(f"Fixed {field} to {averages[field]}")
                    else:
                        logger.info(f"Verified {field} = {value} on UPSDynamicData")
                else:
                    logger.warning(f"⚠️ Critical field '{field}' not found in UPSDynamicData model")

            # Add to hourly buffer if ups_realpower is present
            if 'ups_realpower' in averages:
                self.hourly_data.append({
                    'timestamp': self.next_save_time,  # We use next_save_time which is already in the correct timezone
                    'ups_realpower': averages['ups_realpower']
                })

                # Check if it's time to calculate the hourly average
                current_tz = current_time.astimezone(self.next_hour.tzinfo)
                if current_tz >= self.next_hour:
                    exact_hour = self.next_hour.astimezone(get_configured_timezone()) - timedelta(hours=1)

                    # Correct query with timezone filter
                    hour_data = UPSDynamicData.query.filter(
                        UPSDynamicData.timestamp_tz >= exact_hour,
                        UPSDynamicData.timestamp_tz < exact_hour + timedelta(hours=1)
                    ).all()

                    if hour_data:
                        powers = [d.ups_realpower for d in hour_data if d.ups_realpower is not None]
                        if powers:
                            hourly_avg = sum(powers) / len(powers)
                            dynamic_data.ups_realpower_hrs = round(hourly_avg, 2)
                            logger.info(f"📊 Calculated hourly average from {len(powers)} records: {hourly_avg}W. Saving ups_realpower_hrs = {dynamic_data.ups_realpower_hrs}")
                        else:
                            logger.warning("📊 No power data available for hourly average calculation.")
                    else:
                        logger.warning("📊 No hourly data found in database for hourly average calculation.")


                    # Reset for the next hour
                    self.hourly_data = []
                    self.next_hour = self.get_next_hour(current_time)
                    logger.info(f"Next hourly calculation at: {self.next_hour}")
                else:
                    logger.debug("⏰ Not yet time for hourly calculation.")


            # Save in the database
            with data_lock:
                db.session.add(dynamic_data)
                db.session.commit()
                logger.info(f"💾 Successfully saved averaged data at {self.next_save_time}")

            # Clean the buffer and update next_save_time
            self.data = []
            self.df = None
            self.next_save_time = self.get_next_minute(current_time)
            logger.info(f"Next save scheduled for: {self.next_save_time}")

            if self.should_aggregate_daily(current_time):
                self.aggregate_daily_data(db, UPSDynamicData, current_time)

            return True

        except Exception as e:
            logger.error(f"❌ Error saving averaged data: {str(e)}", exc_info=True)
            return False

    def get_next_minute(self, current_time):
        """
        Calculate the exact next minute in the configured timezone
        
        Args:
            current_time (datetime): Current timestamp
        
        Returns:
            datetime: Exact next minute timestamp
        """
        # Get the configured timezone
        tz = get_configured_timezone()
        
        # Convert the current time to the configured timezone
        local_time = current_time.astimezone(tz)
        
        # Calculate the exact next minute
        next_minute = local_time.replace(second=0, microsecond=0) + timedelta(minutes=1)
        
        logger.debug(f"Next save time calculated: {next_minute}")
        return next_minute

    def add(self, timestamp, data):
        """
        Add data to the buffer and initialize next_save_time if necessary
        
        Args:
            timestamp (datetime): Data timestamp
            data (dict): UPS data dictionary
        """
        # If it's the first data point, initialize next_save_time
        if self.next_save_time is None:
            self.next_save_time = self.get_next_minute(timestamp)
            logger.info(f"First data point received. Next save scheduled for: {self.next_save_time}")

        # Ensure keys are in the correct format (with underscores instead of dots)
        formatted_data = {}
        for key, value in data.items():
            # Convert key from dot notation to underscore if needed
            formatted_key = key.replace('.', '_')
            formatted_data[formatted_key] = value

        # Log the transformation if it occurred
        if len(formatted_data) != len(data):
            logger.info(f"Transformed {len(data)} keys to {len(formatted_data)} formatted keys")
        elif any(key != formatted_key for key, formatted_key in zip(data.keys(), formatted_data.keys())):
            logger.info("Some keys were transformed from dots to underscores")

        # Add to the buffer
        self.data.append((timestamp, formatted_data))
        
        # Convert the buffer to DataFrame
        df_data = []
        for ts, d in self.data:
            row = {'timestamp': ts, **d}
            df_data.append(row)
        
        self.df = pd.DataFrame(df_data)
        logger.debug(f"📥 Added data point (buffer: {len(self.data)})")
        
        # Broadcast cache update to clients via WebSocket
        self.broadcast_cache_update(formatted_data)

    def is_save_time(self, current_time):
        """
        Check if it's time to save the data
        
        Args:
            current_time (datetime): Current timestamp
            
        Returns:
            bool: True if it's time to save
        """
        if self.next_save_time is None:
            return False
            
        # Convert the current time to the same timezone as next_save_time
        current_tz = current_time.astimezone(self.next_save_time.tzinfo)
        
        # Check if we've reached the scheduled save time
        if current_tz >= self.next_save_time:
            logger.debug(f"🕒 Save time reached: {current_tz} >= {self.next_save_time}")
            return True
        
        # Alternative condition: buffer is full (based on adjusted size from polling interval)
        if len(self.data) >= self.size:
            logger.debug(f"🕒 Buffer is full ({len(self.data)} >= {self.size}). Saving now.")
            return True
        
        return False

    def calculate_averages(self):
        """
        Calculate averages using Pandas:
        - Automatically identifies numeric columns
        - Calculates average for numeric values
        - Takes last value for non-numeric columns
        
        Returns:
            dict: Dictionary with averages and last values
        """
        if self.df is None or self.df.empty:
            logger.warning("⚠️ No data available for averaging")
            return None

        try:
            logger.info("📊 Starting Pandas data processing...")
            
            # Log all columns for debugging
            logger.debug(f"Available columns: {list(self.df.columns)}")
            
            # Check if ups_realpower exists in the data
            if 'ups_realpower' in self.df.columns:
                logger.info(f"ups_realpower values in buffer: {list(self.df['ups_realpower'].values)}")
            else:
                logger.warning("ups_realpower not found in data columns!")
            
            # Identify numeric columns
            numeric_cols = self.df.select_dtypes(include=[np.number]).columns
            non_numeric_cols = self.df.select_dtypes(exclude=[np.number]).columns
            non_numeric_cols = non_numeric_cols.drop('timestamp') if 'timestamp' in non_numeric_cols else non_numeric_cols

            logger.debug(f"🔢 Processing {len(numeric_cols)} numeric columns with Pandas")
            # Calculate averages for numeric columns (rounded to 2 decimal places)
            averages = self.df[numeric_cols].mean().round(2).to_dict()

            logger.debug(f"📝 Processing {len(non_numeric_cols)} non-numeric columns")
            # Take last value for non-numeric columns
            last_values = self.df[non_numeric_cols].iloc[-1].to_dict()

            # Combine results
            result = {**averages, **last_values}
            
            # Log important calculated values
            logger.info(f"Calculated averages: ups_load={result.get('ups_load', 'N/A')}%, ups_realpower={result.get('ups_realpower', 'N/A')}W")
            
            logger.info(f"✅ Pandas processing complete - averaged {len(numeric_cols)} numeric fields")
            return result

        except Exception as e:
            logger.error(f"❌ Error in Pandas processing: {str(e)}")
            return None

    def is_full(self):
        """
        Check if the buffer is full
        
        Returns:
            bool: True if buffer is full
        """
        return len(self.data) >= self.size

    def should_aggregate_daily(self, current_time):
        """
        Check if it's midnight for daily aggregation
        
        Args:
            current_time: Current timestamp
            
        Returns:
            bool: True if daily aggregation should be performed
        """
        tz = get_configured_timezone()
        local_time = current_time.astimezone(tz)
        logger.debug(f"🕰️ should_aggregate_daily - Local time: {local_time}, Hour: {local_time.hour}, Minute: {local_time.minute}")

        if local_time.hour == 0 and local_time.minute == 0:
            if self.last_daily_aggregation != local_time.date():
                self.last_daily_aggregation = local_time.date()
                logger.info("📅 It's midnight - Daily aggregation should start.")
                return True
        logger.debug("📅 Not midnight yet, daily aggregation not needed.")
        return False

    def aggregate_daily_data(self, db, UPSDynamicData, current_time):
        """
        Perform daily aggregation
        
        Args:
            db: Database instance
            UPSDynamicData: UPS dynamic data model class
            current_time: Current timestamp
        """
        try:
            tz = get_configured_timezone()
            aggregation_time = current_time.astimezone(tz).replace(hour=0, minute=0, second=0)
            logger.debug(f"📅 Starting daily aggregation at: {aggregation_time}")

            # Calculate the average of hourly averages
            logger.debug("📅 Querying hourly averages for daily aggregation...")
            from sqlalchemy import func
            daily_data = db.session.query(
                func.avg(UPSDynamicData.ups_realpower_hrs).label('daily_avg')
            ).filter(
                UPSDynamicData.timestamp_tz >= aggregation_time - timedelta(days=1),
                UPSDynamicData.timestamp_tz < aggregation_time
            ).scalar()

            if daily_data:
                daily_avg = round(float(daily_data), 2)
                logger.debug(f"📅 Daily average power calculated: {daily_avg}W")

                new_daily = UPSDynamicData(
                    timestamp_tz=aggregation_time - timedelta(days=1),
                    ups_realpower_days=daily_avg
                )

                with data_lock:
                    db.session.add(new_daily)
                    db.session.commit()
                    logger.info(f"📅 Daily aggregation saved: {daily_avg}W for {aggregation_time.date()}")
            else:
                logger.warning("📅 No hourly data found for daily aggregation.")

        except Exception as e:
            logger.error(f"❌ Daily aggregation error: {str(e)}", exc_info=True)
            db.session.rollback()

    def get(self):
        """
        Return the current data stored in cache.
        
        Returns:
            list: List of data points in the cache
        """
        return self.data
        
    def broadcast_cache_update(self, data):
        """
        Broadcast cache update to all connected WebSocket clients
        
        Args:
            data (dict): The new data to be broadcasted
        """
        try:
            # Only send if there's meaningful data
            if not data:
                return
            
            # Create a timestamp for the broadcast
            broadcast_data = {
                'timestamp': datetime.now().isoformat(),
                **data  # Include all data fields from the cache
            }
            
            # Check if data changed meaningfully from last broadcast to avoid unnecessary broadcasts
            if self.last_broadcast:
                # Check status change (always broadcast if status changes)
                status_changed = broadcast_data.get('ups_status') != self.last_broadcast.get('ups_status')
                
                # Check for significant numeric changes
                significant_change = False
                important_metrics = ['ups_load', 'battery_charge', 'ups_realpower', 'input_voltage']
                for metric in important_metrics:
                    if metric in broadcast_data and metric in self.last_broadcast:
                        try:
                            current_val = float(broadcast_data[metric] or 0)
                            last_val = float(self.last_broadcast[metric] or 0)
                            if abs(current_val - last_val) >= 1.0:  # 1% or 1W threshold
                                significant_change = True
                                break
                        except (ValueError, TypeError):
                            # If values can't be compared, assume there's a change
                            significant_change = True
                            break
                
                # Skip broadcast if no meaningful changes
                if not status_changed and not significant_change:
                    logger.debug("🔄 Skipping WebSocket broadcast - no significant changes")
                    return
            
            # Update last broadcast
            self.last_broadcast = broadcast_data.copy()
            
            # Broadcast the data
            logger.debug(f"📡 Broadcasting cache update with {len(broadcast_data)} fields")
            websocket.emit('cache_update', broadcast_data)
            
        except Exception as e:
            logger.error(f"❌ Error broadcasting cache update: {str(e)}")
    
    def get_latest_cache_data(self):
        """
        Get the latest cache data for new WebSocket connections
        
        Returns:
            dict: Latest cache data or empty dict if no data
        """
        if not self.last_broadcast:
            return {}
        return self.last_broadcast

def save_ups_data(db, UPSDynamicData, ups_data_cache):
    """
    Get the current UPS data and save it to the cache
    
    Args:
        db: Database instance
        UPSDynamicData: UPS dynamic data model class
        ups_data_cache: UPS data cache instance
        
    Returns:
        tuple: (success, error_message)
    """
    try:
        # Use configured timezone
        tz = get_configured_timezone()
        now = datetime.now(tz)
        
        # Get polling interval from VariableConfig
        try:
            if hasattr(db, 'ModelClasses') and hasattr(db.ModelClasses, 'VariableConfig'):
                model_class = db.ModelClasses.VariableConfig
            else:
                from core.db.ups import VariableConfig
                model_class = VariableConfig
            
            config = model_class.query.first()
            polling_interval = config.polling_interval if config else 1
        except Exception as e:
            logger.error(f"Error getting polling interval: {str(e)}. Using default of 1 second.")
            polling_interval = 1
        
        # Adjust cache size based on polling interval
        # For example, if CACHE_SECONDS is 60 and polling_interval is 2,
        # we should only need 30 samples in the buffer (60/2)
        if polling_interval > 1:
            # Calculate the appropriate buffer size for the current polling interval
            target_buffer_size = max(5, int(CACHE_SECONDS / polling_interval))
            if ups_data_cache.size != target_buffer_size:
                logger.info(f"Adjusting cache buffer size from {ups_data_cache.size} to {target_buffer_size} based on polling interval of {polling_interval} seconds")
                ups_data_cache.size = target_buffer_size
        
        data = get_ups_data()
        
        # Convert DotDict to standard dictionary
        data_dict = vars(data)
        
        # Log important values for debugging
        ups_load = data_dict.get('ups_load', None)
        ups_realpower = data_dict.get('ups_realpower', None)
        ups_realpower_nominal = data_dict.get('ups_realpower_nominal', None)

        
        # Log the buffer
        logger.debug(f"📥 Buffer status before add: {len(ups_data_cache.data)}")
        ups_data_cache.add(now, data_dict)
        logger.debug(f"📥 Buffer status after add: {len(ups_data_cache.data)}")
        
        # Check if it's time to save
        success = ups_data_cache.calculate_and_save_averages(db, UPSDynamicData, now)
        if success:
            logger.info("💾 Successfully saved aligned data to database")
                
        return True, None
    except Exception as e:
        error_msg = f"Error saving data: {str(e)}"
        logger.error(f"❌ {error_msg}")
        return False, error_msg

# Initialize the global cache
ups_data_cache = UPSDataCache(size=CACHE_SECONDS)  # Initial size, will be adjusted based on polling interval

# WebSocket event handlers
@websocket.on('connect')
def handle_websocket_connect():
    """Handle new WebSocket connection and send latest data"""
    from flask import request
    logger.info(f"🟢 WebSocket client connected - SID: {request.sid}")
    # Send initial data to the client
    latest_data = ups_data_cache.get_latest_cache_data()
    if latest_data:
        websocket.emit('cache_update', latest_data, room=request.sid)

@websocket.on('request_cache_data')
def handle_request_cache_data():
    """Handle request for latest cache data"""
    from flask import request
    logger.debug(f"📤 Client {request.sid} requested cache data")
    latest_data = ups_data_cache.get_latest_cache_data()
    websocket.emit('cache_update', latest_data, room=request.sid)

@websocket.on('disconnect')
def handle_websocket_disconnect():
    """Handle WebSocket disconnection"""
    from flask import request
    logger.info(f"🔴 WebSocket client disconnected - SID: {request.sid}")

def init_websocket(app):
    """Initialize WebSocket with Flask app"""
    logger.info("🔌 Initializing UPS Cache WebSocket")
    websocket.init_app(app, cors_allowed_origins="*", async_mode='eventlet')
    return websocket 