# Skill: Real Estate Matching Intelligence

This skill helps implement logic related to matching client preferences with real estate units.

## Client data

Client profiles may contain:

- max price
- preferred layouts
- minimum area
- location (polygon or commute)
- outdoor preferences
- building amenities
- technology preferences
- financing preferences

## Matching approach

Units should not only be filtered but also **scored**.

Example scoring:

price fit
location fit
layout fit
feature fit

Final score:

0–100 match score.

## Output requirements

When suggesting units, always explain:

- why the unit matches
- what might not match perfectly
- what alternatives exist.

## Broker workflow

The broker uses the system during a meeting with a client.

The system must support:

- quick adjustments
- visual explanations
- map interaction