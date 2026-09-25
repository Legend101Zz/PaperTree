"""The API's routes, one module per slice that owns them (contracts.md §2, slice-plan.md §3).

    auth        §2.1                                   unchanged
    papers      §2.2 papers, file, ir, assets          S1
    jobs        §2.2 GET /jobs/{job_id}                S1
    highlights  §2.4                                   S4
    health      §2.8 GET /healthz                      S0

`app.create_app()` includes them in a fixed order. Order matters only where two paths overlap, and
the one overlap is inside `highlights` (`PUT …/resolutions` vs `…/{highlight_id}`), which that
module registers in the safe order itself.
"""
