# H&S Daily Reminder Announcement Design

## Goal

Expand the reusable H&S staff-announcement draft into one chronological daily
checklist covering attendance, H&S, and assigned-vehicle duties.

## Approved wording

The announcement must tell staff to:

1. **Clock in** at the start of the shift.
2. Complete **Daily H&S check-in** after clock-in and before field work.
3. If assigned a vehicle, complete **Daily vehicle check** when the pre-trip
   check is due and before using the vehicle.
4. **Clock out** at the end of the shift.

These names match the actions shown in My FibreFlow. Existing safety language
about truthful declarations, pay, crew leads, and blocked activities remains
unchanged.

## Boundaries

- The generated file remains marked `DRAFT — DO NOT SEND`.
- The change does not send an announcement or change production data.
- No attendance, vehicle, or H&S application behavior changes.

## Verification

Extend the rollout-pack unit test to require the four duties and their order,
then run that focused test and `npm run ci:quick`.
