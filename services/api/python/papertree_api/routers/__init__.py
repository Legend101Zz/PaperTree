"""The API's routes, one module per slice that owns them (contracts.md §2, slice-plan.md §3).

    auth        §2.1                                   unchanged
    papers      §2.2 papers, file, ir, assets          S1  (DELETE, retry, reparse: 501 stubs)
    jobs        §2.2 GET /jobs/{job_id}                S1
    highlights  §2.4                                   S4
    health      §2.8 GET /healthz                      S0
    threads     §2.5 threads + POST /runs/{id}/cancel  S5
    summary     §2.5 summary                           S5
    usage       §2.5 GET /usage                        S5
    boards      §2.7 canvas                            S7  (501 stubs)
    internal    §4 the agent's paper tools             S5

A 501 stub already declares its FINAL models: auth, path and query parameters and the body model
run first, then `errors.not_implemented(slice)` — so a stub refuses exactly what the finished
route will refuse, and the slice replaces one `raise` without redefining a model.

`app.create_app()` includes them in a fixed order. Order matters only where two paths overlap, and
the one overlap is inside `highlights` (`PUT …/resolutions` vs `…/{highlight_id}`), which that
module registers in the safe order itself.

`ask.py` (`POST /papers/{id}/ask`, #76) is gone: S5 deleted it with the threads (slice-plan §R R9).
"""
