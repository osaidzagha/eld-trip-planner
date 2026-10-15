from django.urls import path
from planner.views import GeocodeView, PlanTripView, HealthView

urlpatterns = [
    path("geocode/", GeocodeView.as_view(), name="geocode"),
    path("plan-trip/", PlanTripView.as_view(), name="plan-trip"),
    path("health/", HealthView.as_view(), name="health"),
]
