import requests
import datetime

url = "https://webhook-test.com/ee1f2b4439ece4f3d393986b46f36526"
data = {"message": "Test from simple script", "timestamp": datetime.datetime.now().isoformat()}
headers = {"Content-Type": "application/json", "User-Agent": "SimpleTestScript/1.0"}

print(f"Attempting to POST to: {url}")
try:
    # Increased timeout for testing
    response = requests.post(url, headers=headers, json=data, timeout=30)
    response.raise_for_status() # Raise an exception for bad status codes (4xx or 5xx)
    print("Success!")
    print(f"Status Code: {response.status_code}")
    # print(f"Response Body: {response.text}")
except requests.exceptions.Timeout as e:
    print(f"Error: Request timed out - {e}")
except requests.exceptions.ConnectionError as e:
    print(f"Error: Connection error (DNS or network issue) - {e}")
except requests.exceptions.RequestException as e:
    print(f"Error: General request error - {e}")

print("Script finished.")
