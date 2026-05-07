import time
import datetime

def test_scheduled_job():
    print(f"Scheduled job test at {datetime.datetime.now()}")
    # Simulate a task
    time.sleep(1)
    print("Job completed successfully")

if __name__ == "__main__":
    test_scheduled_job()