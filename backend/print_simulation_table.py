from datetime import datetime
from hos_engine import plan_trip_hos, TripLeg

legs = [
    TripLeg(
        name="Current to Pickup",
        start_label="Los Angeles, CA",
        end_label="Barstow, CA",
        distance_miles=150.0,
        duration_hours=2.5,
    ),
    TripLeg(
        name="Pickup to Dropoff",
        start_label="Barstow, CA",
        end_label="Atlanta, GA",
        distance_miles=2350.0,
        duration_hours=39.0,
    ),
]

start_time = datetime(2026, 10, 12, 7, 0, 0)
segments, daily_logs = plan_trip_hos(legs, cycle_used=20.0, start_time=start_time)

print("=========================================================================================")
print("          2,500-MILE TRIP DAY-BY-DAY SEGMENT TABLE (cycle_used = 20.0 hrs)              ")
print("=========================================================================================")

for day_idx, log in enumerate(daily_logs, start=1):
    print(f"\n================================ DAY {day_idx}: {log.date} ================================")
    print(f"Miles Driven Today: {log.miles_driving_today:.1f} mi | Total Accumulated Mileage: {log.total_mileage_today:.1f} mi")
    h = log.hours_per_status
    print(f"Status Hours: OFF_DUTY: {h['OFF_DUTY']:.2f}h | SLEEPER: {h['SLEEPER']:.2f}h | DRIVING: {h['DRIVING']:.2f}h | ON_DUTY: {h['ON_DUTY_NOT_DRIVING']:.2f}h | DAY TOTAL: {log.total_hours:.2f}h")
    print(f"Recap: On-Duty Today: {log.recap['on_duty_today']:.2f}h | Running Cycle Total: {log.recap['cycle_used_total']:.2f}h / 70.0h | Avail Tomorrow: {log.recap['available_tomorrow']:.2f}h")
    print("-" * 105)
    print(f"{'Time Range':<33} | {'Status':<20} | {'Duration':<9} | {'Miles':<8} | {'Reason':<15} | Location")
    print("-" * 105)
    for seg in log.segments:
        start_s = seg.start.strftime("%Y-%m-%d %H:%M")
        end_s = seg.end.strftime("%H:%M") if seg.end.date() == seg.start.date() else seg.end.strftime("%Y-%m-%d %H:%M")
        time_str = f"{start_s} -> {end_s}"
        print(f"{time_str:<33} | {seg.status:<20} | {seg.duration_hours:>7.2f}h | {seg.miles:>6.1f}mi | {seg.reason:<15} | {seg.location_label}")

print("\n=========================================================================================")
print(f"Trip Summary: Total Days = {len(daily_logs)}, Total Miles = {sum(l.miles_driving_today for l in daily_logs):.1f}")
print("=========================================================================================")
