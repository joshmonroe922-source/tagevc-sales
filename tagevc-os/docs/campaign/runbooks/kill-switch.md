# Kill switch

```sql
update public.ecc_entity_flags set kill_switch = true where entity_id = 'ENT-R619';
```

Also pause campaign: `kill_paused` on `ecc_campaigns` or POST `.../pause`.
