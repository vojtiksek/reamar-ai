# Reamar AI – Architecture

## Backend

FastAPI application.

Main modules:

app/models.py  
Database models.

app/main.py  
API routes.

app/import_units.py  
Unit importing.

Scripts:

scripts/recompute_project_micro_location.py  
scripts/recompute_project_noise.py  

---

## Frontend

Next.js App Router.

Key pages:

/projects
/projects/[id]

/units
/units/[id]

/clients
/clients/[id]

---

## Map components

ClientLocationMap.tsx  
ClientLocationMapInner.tsx

Used for polygon editing and location filtering.

---

## Data sources

Data about projects and units are scraped from developer websites.

Important data fields:

price
layout
area
floor
availability
developer

---

## Location analysis

Projects have:

lat
lng

Future features include:

commute time analysis
isochrone polygons
walkability scoring
noise scoring