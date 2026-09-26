// Owner: Person A (see CLAUDE.md)
// Apify actor entry point. Spec: docs/plan.md §5.1. Output: shared/contracts/CONTRACTS.md C2.
// TODO Person A:
//   - input { points: [{lat, lon, nm}], forceFallback }
//   - poll adsb.lol, fall back to adsb.fi; dedupe aircraft by hex; 1.5 s between calls
//   - Actor.pushData(C2 rows), or one {ts, empty: true, errors} row if nothing came back
//   - Actor.setValue('RUN_META', {ts, source, aircraft, failover, errors})
throw new Error('TODO: Person A (features/collect/actor)');
