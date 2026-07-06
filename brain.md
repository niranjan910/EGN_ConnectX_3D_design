# EGN CONNECT X 2026 – Floor Planner Analysis

## Event Information
- **Event:** EGN CONNECT X 2026
- **Venue:** Bombay Convention & Exhibition Centre (BEC, NESCO), Mumbai, India
- **Dates:** November 03–04, 2026

## Floor Plan Design Analysis

The floor plan follows a structured exhibition layout designed for maximum visitor flow, exhibitor visibility, and category-based segmentation.

### 1. Entry & Visitor Flow
- Two main access points:
  - **Entry/Exit Gate 1**
  - **Entry/Exit Gate 2**
- Entry gates are positioned on the left side to distribute visitor traffic efficiently.
- Both gates carry **EGN CONNECT X branded banners** (entry / exit branding).
- An **outdoor entrance plaza** sits in front of the gates (outside the main hall) and holds all the arrival infrastructure:
  - A **circular EGN CONNECT X branding drum** (9 m diameter, 6 ft high) directly in front of the gates as the centrepiece.
  - A grouped row of **visitor service counters** on the right, all facing outward toward arriving guests (see §7).
  - A **coffee stall** with café seating on the left.
  - People throughout the plaza (queues at the counters, guests at the coffee stall).

### 2. Zone Segmentation
The exhibition is divided into multiple thematic zones:

| Zone | Category |
|------|------|
| A | Premium exhibitors |
| B | Standard exhibition booths |
| C | Large exhibition clusters |
| D | Mid-sized exhibition blocks |
| E | Sponsor & feature zones |
| M | Meeting areas |
| Conference Halls | Educational sessions |

### 3. Booth Sizes
The layout uses multiple booth formats:
- 9 SQM
- 12 SQM
- 18 SQM
- 24 SQM
- 30 SQM
- 42 SQM
- 54 SQM

### 4. Conference Area
Four conference halls are positioned on the right side:
- Conference Hall 1 – K12
- Conference Hall 2 – International Schools / Career Counsellors Meet
- Conference Hall 3 – Early Learnings
- Conference Hall 4 – Higher Education

### 5. Visitor Engagement Areas
- Coffee Lounge 2
- Meeting Zones (M1–M4)
- Open circulation corridors

### 6. Design Principles Observed
- Category-based zoning
- Clear navigation paths
- Large anchor booths
- Balanced traffic distribution
- Dedicated networking spaces
- High visibility conference area

### 7. Entrance Services (3D model — Version 2)
A dedicated service area is modelled in the **outdoor entrance plaza** (outside the gates). The four counters are grouped together on the **right**, all facing **outward** toward arriving guests:

| Counter | Footprint | Height | Purpose |
|---------|-----------|--------|---------|
| **Registration Counter** | 5 m × 10 m (largest) | 9 ft | Badge collection & visitor registration |
| Travel Desk | 4 m × 6 m | ~8 ft | Cabs, transfers & travel assistance |
| Lost & Found | 4 m × 6 m | ~8 ft | Report or recover lost items |
| Baggage & Deposit | 4 m × 8 m | ~8 ft | Cloakroom & baggage deposit |

The Registration Counter is intentionally the largest of the four. A **coffee stall** (with a canopy, café tables and umbrellas) sits on the **left** of the plaza.

## 3D Model Build Notes (Version 2 — `Floor_Planner_version2.html`)
- **Uniform booth height:** every exhibition stand is built to a consistent **9 ft (2.7432 m)** wall height.
- **Footprint accuracy:** booth stands are auto-resolved to sit **together as clean, non-overlapping blocks** matching the source plan — e.g. C1–C4 form a tight 2×2 quad. Each stand picks the orientation that fits its neighbours and keeps a thin service aisle, so no booths clip through one another (the earlier model had ~68 overlapping pairs; the corrected model has none).
- **Gate branding:** each entry/exit gate carries an EGN CONNECT X banner.
- **Outdoor entrance plaza:** all arrival infrastructure sits *outside* the hall in a paved forecourt — the 9 m circular branding drum (6 ft tall, wordmark wrapped + logo medallion on top) in front of the gates, the four service counters grouped on the right facing outward, and a coffee stall on the left. People populate the plaza.
- The model remains a single, self-contained offline HTML file (Three.js embedded).

## Recommended Floor Planner Structure

```text
ENTRY
│
├── Premium Zone (A)
├── Exhibition Zone B
├── Exhibition Zone C
├── Exhibition Zone D
├── Sponsor Zone (E)
├── Meeting Zone (M)
├── Coffee Lounge
└── Conference Halls
```

## Suggested Improvements
1. Add color coding for each zone.
2. Increase wayfinding signage.
3. Add networking lounges.
4. Create sponsor branding corridors.
5. Include emergency routes.
6. Add QR-based navigation.

---
Source: EGN CONNECT X Tentative Floor Plan
