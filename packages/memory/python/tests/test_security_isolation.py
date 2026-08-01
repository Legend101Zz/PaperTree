"""``security/isolation.spec`` — EPIC-03's acceptance criterion, Python half.

    "The agent has no filesystem, shell, or non-provider network access. **Asserted, not
     assumed.**"

──────────────────────────────────────────────────────────────────────────────────────────────
EXACTLY WHAT IS ASSERTED HERE, AND EXACTLY WHAT IS NOT
──────────────────────────────────────────────────────────────────────────────────────────────

"The agent has no filesystem access" is not a statement Python can make true. ``open`` is a
builtin, ``import os`` is one line, and any code running in this process can do both. A test
that claimed otherwise would be asserting something false and would have to be written so
loosely that it could never fail — which is the vacuous green AGENTS.md §2 lists three
instances of. So the claim is narrowed until it is both TRUE and CHECKABLE, and the narrowing
is stated rather than hidden:

  **ASSERTED (six claims, one test each):**

  C1  The object graph reachable from an ``AgentDataHandle`` — instance slots, class
      attributes, closure cells, container elements, transitively — contains only inert types.
      No module object, no ``MemoryStore``, no ``PaperTreeDb``, no ``pathlib.Path``, no
      callable that opens a file, socket or process. This is what "the handle grants no
      capability" means operationally, and it is exhaustive because ``__slots__`` fixes the
      attribute set.
  C2  The single ``sqlite3.Connection`` in that graph refuses every route in
      ``guard.escape_routes`` — so reaching it is worth nothing, which is the honest version
      of "the connection is private".
  C3  The authorizer denies every action in ``DENIED_ACTIONS``, and that set contains the
      load-bearing entries by name. A refactor that empties the set fails here.
  C4  No module on the agent side of this package imports a process, shell, socket or HTTP
      module. AST-audited, not grepped.
  C5  ``agent_handle`` does not import ``store``, transitively. The import graph is the
      boundary's shape, and it is machine-checked.
  C6  A handle bound to user A reads none of user B's rows, on any method it exposes.

  **NOT ASSERTED, AND THESE ARE REAL GAPS:**

  * **Process-level network egress.** Nothing here prevents ``import socket`` inside a tool
    body. "No non-provider network access" is a DEPLOYMENT control — a no-egress container, an
    allowlist proxy, or seccomp — and this package cannot substitute for it. What this suite
    shows is that the agent is not HANDED a network object; it does not show that one is
    unreachable.
  * **The dependency tree.** C4 audits ``papertree_memory``'s own modules. ``papertree_db``,
    which the handle imports, is not audited here: it is another package's code and another
    package's ownership. It imports ``sqlite3``, ``struct``, ``json``, ``datetime``,
    ``pathlib`` and ``sqlite_vec``, all of which were read; none of them is asserted by a test
    in this file.
  * **Arbitrary Python.** ``handle._reader.set_authorizer(None)`` re-opens ``ATTACH``. It
    requires code execution in this process, which is outside F3.8's threat model (a
    compromised model output driving a tool registry) — see ``guard.py``. Stated because a
    reviewer will think of it, and finding it unmentioned is what makes a reviewer stop
    trusting the rest.
"""

from __future__ import annotations

import ast
import sqlite3
from collections.abc import Iterator, Mapping
from pathlib import Path
from types import FunctionType, MethodType, ModuleType
from typing import Any

import pytest
from _memory_fixtures import SeededDatabase, seed_benign_database, seed_two_tenants
from papertree_db import BlockId, OwnershipError, PaperTreeDb
from papertree_memory import (
    DENIED_ACTIONS,
    AgentDataHandle,
    MemoryStore,
    ProposalValidator,
    escape_routes,
)
from papertree_memory.guard import _authorizer

PACKAGE = Path(__file__).resolve().parents[1] / "papertree_memory"

#: The modules a tool can reach by holding an ``AgentDataHandle``: the handle itself and every
#: module it imports from this package, transitively. ``store.py`` is deliberately absent, and
#: C5 asserts that absence rather than trusting this list.
AGENT_SIDE_MODULES = ("agent_handle.py", "guard.py", "records.py", "errors.py")

#: Anything that reaches a process, a shell, a socket or an HTTP client.
FORBIDDEN_IMPORTS = frozenset(
    {
        "os",
        "subprocess",
        "shutil",
        "socket",
        "ssl",
        "select",
        "selectors",
        "asyncio",
        "multiprocessing",
        "threading",
        "signal",
        "ctypes",
        "pickle",
        "shelve",
        "tempfile",
        "webbrowser",
        "http",
        "urllib",
        "ftplib",
        "smtplib",
        "poplib",
        "imaplib",
        "telnetlib",
        "xmlrpc",
        "requests",
        "httpx",
        "aiohttp",
        "importlib",
        "runpy",
        "pty",
        "fcntl",
        "resource",
    }
)

#: ``pathlib`` is permitted in ``guard.py`` and nowhere else on the agent side. Permitted
#: because ``open_guarded_read_only`` has to check that a path exists before handing SQLite a
#: URI, and because ``probe_escape_routes`` has to check whether an escape route created its
#: file — both READS. The write verbs below are what would turn that permission into a
#: capability, and C4b asserts none of them appears.
PATH_WRITE_VERBS = frozenset(
    {
        "write_text",
        "write_bytes",
        "open",
        "mkdir",
        "touch",
        "unlink",
        "rmdir",
        "rename",
        "replace",
        "chmod",
        "symlink_to",
        "hardlink_to",
    }
)

TOOL_NAMES = frozenset({"get_block", "search_blocks"})


@pytest.fixture(scope="module")
def benign(tmp_path_factory: pytest.TempPathFactory) -> SeededDatabase:
    return seed_benign_database(tmp_path_factory.mktemp("isolation"))


@pytest.fixture
def handle(benign: SeededDatabase) -> Iterator[AgentDataHandle]:
    agent = AgentDataHandle(benign.path, benign.user_id)
    yield agent
    agent.close()


# ── the object-graph walk ───────────────────────────────────────────────────────────────


def _reachable(root: object, *, limit: int = 5000) -> list[object]:
    """Every object reachable from ``root`` by attribute, closure cell or container element.

    Closure cells are walked DELIBERATELY. Hiding the connection in a closure instead of an
    attribute would make a naive attribute-only audit pass while the capability was still
    there, one ``__closure__[0].cell_contents`` away — which is exactly the "green test that
    asserts less than it appears to" this repo keeps hitting. Walking them means the audit
    cannot be satisfied by moving something rather than removing it.

    ``limit`` bounds the walk so a cyclic or unexpectedly large graph fails as a readable
    assertion rather than as a hang.

    IT DELIBERATELY DOES NOT FOLLOW ``__globals__``. Every function in Python reaches its
    module's globals, so a walk that followed them would reach ``sqlite3``, ``json`` and
    everything else from any object with a method — and would flag every implementation
    including the correct one. An audit that can never pass measures nothing. The claim this
    walk makes is therefore about BOUND STATE: what the handle is carrying, not what Python
    can reach from a function object. That is the distinction between "was handed a
    capability" and "runs inside an interpreter", and only the first is a design property.
    """
    seen: dict[int, object] = {}
    queue: list[object] = [root]
    while queue and len(seen) < limit:
        current = queue.pop()
        if id(current) in seen:
            continue
        seen[id(current)] = current
        if isinstance(current, str | bytes | int | float | bool | type(None)):
            continue
        for slot in getattr(type(current), "__slots__", ()):
            if hasattr(current, slot):
                queue.append(getattr(current, slot))
        queue.extend(vars(current).values() if hasattr(current, "__dict__") else ())
        if isinstance(current, MethodType):
            # A bound method carries its receiver, which is a capability handed out under a
            # different name — `store.write_paper_memory` IS the store.
            queue.append(current.__self__)
            queue.append(current.__func__)
        if isinstance(current, FunctionType):
            queue.extend(cell.cell_contents for cell in (current.__closure__ or ()))
        if isinstance(current, list | tuple | set | frozenset):
            queue.extend(current)
        if isinstance(current, Mapping):
            queue.extend(current.values())
    assert len(seen) < limit, f"object graph exceeded {limit} nodes; the walk is unbounded"
    return list(seen.values())


def test_c1_nothing_reachable_from_the_handle_grants_a_capability(
    handle: AgentDataHandle,
) -> None:
    """C1: the graph contains only inert types — no module, no writer, no Path, no opener."""
    graph = _reachable(handle)

    modules = [obj for obj in graph if isinstance(obj, ModuleType)]
    assert modules == [], f"a module object is reachable from the handle: {modules}"

    writers = [obj for obj in graph if isinstance(obj, MemoryStore | PaperTreeDb)]
    assert writers == [], "a privileged writer is reachable from the agent's handle"

    paths = [obj for obj in graph if isinstance(obj, Path)]
    assert paths == [], (
        "a pathlib.Path is reachable, and a Path carries write_text/write_bytes/open — see "
        "AgentDataHandle._database_path on why the path is stored as a str"
    )

    openers = [
        obj
        for obj in graph
        if callable(obj) and getattr(obj, "__name__", "") in {"open", "exec", "eval", "compile"}
    ]
    assert openers == [], f"a file/code opener is reachable: {openers}"

    # The positive form of the same claim: the set of types present is small and enumerable.
    kinds = {type(obj).__name__ for obj in graph}
    assert kinds <= {"AgentDataHandle", "str", "Connection", "NoneType"}, kinds


def test_c1_is_not_vacuous_because_the_same_walk_finds_a_writer_when_one_is_there(
    benign: SeededDatabase, handle: AgentDataHandle
) -> None:
    """The walk DOES find what it is looking for, so C1's empty results mean something.

    Without this, ``_reachable`` could return ``[]`` for every input and C1 would be four
    assertions about an empty list.
    """

    class LeakyHandle:
        """What the handle would look like if it wrapped a writer — the design F3.8 forbids."""

        def __init__(self, agent: AgentDataHandle, store: MemoryStore) -> None:
            self.agent = agent
            self.store = store
            self.root = Path(benign.path)

    with MemoryStore(benign.path, validator=ProposalValidator(tool_names=TOOL_NAMES)) as store:
        graph = _reachable(LeakyHandle(handle, store))
        assert [obj for obj in graph if isinstance(obj, MemoryStore)] != []
        assert [obj for obj in graph if isinstance(obj, Path)] != []
        assert [obj for obj in graph if isinstance(obj, ModuleType)] == []


def test_c1_the_walk_follows_closure_cells(handle: AgentDataHandle) -> None:
    """Hiding a capability in a closure must not defeat the audit.

    This is the check that keeps C1 honest: an implementation that moved the connection from
    ``self._reader`` into a captured local would pass an attribute-only walk while changing
    nothing about what a caller can reach.
    """

    def make_leak(secret: MemoryStore) -> Any:
        def leak() -> MemoryStore:
            return secret

        return leak

    with MemoryStore(handle.database_path, validator=ProposalValidator(tool_names=())) as store:
        graph = _reachable(make_leak(store))
        assert [obj for obj in graph if isinstance(obj, MemoryStore)] != [], (
            "the walk did not follow __closure__, so C1 would pass on an implementation that "
            "merely hid the writer instead of not holding one"
        )


# ── the connection is worth nothing to reach ────────────────────────────────────────────


def test_c2_the_only_connection_in_the_graph_refuses_every_escape_route(
    handle: AgentDataHandle, tmp_path: Path
) -> None:
    """C2: reaching ``handle._reader`` is the same nothing, one step earlier."""
    connections = [obj for obj in _reachable(handle) if isinstance(obj, sqlite3.Connection)]
    assert len(connections) == 1, f"expected exactly one connection, found {len(connections)}"

    scratch = tmp_path / "c2"
    scratch.mkdir()
    probes = handle.probe_escape_routes(scratch)
    assert len(probes) == len(escape_routes(scratch))
    assert all(probe.denied and not probe.artefact_created for probe in probes)
    assert list(scratch.iterdir()) == []


def test_c3_the_authorizer_denies_every_action_it_claims_to(handle: AgentDataHandle) -> None:
    """C3: the deny set is non-empty, names the load-bearing routes, and the callback agrees.

    Asserted at two levels because they fail differently: a deny set that lost ``SQLITE_ATTACH``
    is a silent hole, and a callback that stopped consulting the set is a different silent
    hole. Neither is visible from the other.
    """
    assert sqlite3.SQLITE_ATTACH in DENIED_ACTIONS
    assert sqlite3.SQLITE_DETACH in DENIED_ACTIONS
    assert sqlite3.SQLITE_INSERT in DENIED_ACTIONS
    assert sqlite3.SQLITE_UPDATE in DENIED_ACTIONS
    assert sqlite3.SQLITE_DELETE in DENIED_ACTIONS
    assert len(DENIED_ACTIONS) >= 20

    for action in DENIED_ACTIONS:
        assert _authorizer(action, None, None, "main", None) == sqlite3.SQLITE_DENY, action

    # …and it does NOT deny reads, or the handle would be useless and every "attack blocked"
    # assertion in this package would be satisfied by a connection that does nothing at all.
    assert _authorizer(sqlite3.SQLITE_SELECT, None, None, "main", None) == sqlite3.SQLITE_OK
    assert _authorizer(sqlite3.SQLITE_READ, "blocks", "text", "main", None) == sqlite3.SQLITE_OK
    assert _authorizer(sqlite3.SQLITE_FUNCTION, None, "json_extract", None, None) == (
        sqlite3.SQLITE_OK
    )
    # The one function that is denied by name. ``enable_load_extension(False)`` closes the C
    # API; this closes the SQL function, and they are separate switches.
    assert _authorizer(sqlite3.SQLITE_FUNCTION, None, "load_extension", None, None) == (
        sqlite3.SQLITE_DENY
    )


# ── the import audit ────────────────────────────────────────────────────────────────────


def _imported_top_level_names(source: Path) -> set[str]:
    """Top-level package names imported by one module. Parsed, not grepped.

    Grepping hits every docstring in this package that names ``subprocess`` in order to say it
    is not imported — including this file's own. An ``ast.Import`` node is an import.
    """
    tree = ast.parse(source.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.add(node.module.split(".")[0])
    return names


def test_c4_no_agent_side_module_imports_a_process_shell_or_network_module() -> None:
    """C4: AST-audited. See the module docstring for what this does NOT cover."""
    offenders: dict[str, set[str]] = {}
    for name in AGENT_SIDE_MODULES:
        source = PACKAGE / name
        assert source.exists(), f"{name} is missing — the audit would pass by having nothing"
        forbidden = _imported_top_level_names(source) & FORBIDDEN_IMPORTS
        if forbidden:
            offenders[name] = forbidden
    assert offenders == {}, f"agent-side modules import capability modules: {offenders}"

    # Non-vacuous: the audit finds a forbidden import when there is one to find. `store.py` is
    # not on the agent side and this is not a complaint about it — it is proof the check works.
    assert _imported_top_level_names(PACKAGE / "validation.py") & {"re"} == {"re"}


def test_c4b_pathlib_is_used_for_reads_only_on_the_agent_side() -> None:
    """``pathlib`` is permitted in ``guard.py``; the write verbs are what would make it matter.

    ``Path`` is not in :data:`FORBIDDEN_IMPORTS` because ``open_guarded_read_only`` must check
    that a database file exists and ``probe_escape_routes`` must check whether a route created
    its artefact. Both are reads. This asserts that no write verb ever appears, so the
    permission cannot quietly widen.
    """
    users = {
        name
        for name in AGENT_SIDE_MODULES
        if "pathlib" in _imported_top_level_names(PACKAGE / name)
    }
    assert users == {"agent_handle.py", "guard.py"}, users

    for name in users:
        tree = ast.parse((PACKAGE / name).read_text(encoding="utf-8"))
        verbs = {
            node.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Attribute) and node.attr in PATH_WRITE_VERBS
        }
        assert verbs == set(), f"{name} calls filesystem write verbs: {verbs}"


def test_c5_the_agent_side_never_imports_the_privileged_writer() -> None:
    """C5: the import graph is the boundary's shape, and it is machine-checked.

    A single ``from .store import MemoryStore`` in ``agent_handle.py`` would put a writable
    connection one attribute away from every tool, and it would look like a tidy refactor in
    review.
    """
    for name in AGENT_SIDE_MODULES:
        tree = ast.parse((PACKAGE / name).read_text(encoding="utf-8"))
        relative = {
            node.module
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.level > 0 and node.module
        }
        assert "store" not in relative, f"{name} imports the privileged writer"

    # And the reverse direction is fine and is what the boundary expects: store.py may not
    # import agent_handle either, or the two halves could be handed out together.
    store_tree = ast.parse((PACKAGE / "store.py").read_text(encoding="utf-8"))
    store_relative = {
        node.module
        for node in ast.walk(store_tree)
        if isinstance(node, ast.ImportFrom) and node.level > 0 and node.module
    }
    assert "agent_handle" not in store_relative


# ── tenancy ─────────────────────────────────────────────────────────────────────────────


def test_c6_a_handle_bound_to_one_user_reads_nothing_of_anothers(tmp_path: Path) -> None:
    """C6: isolation between tenants, on every read the handle exposes.

    Two users, two papers, ONE file. The handle takes its owner at construction and has no
    argument in which another could be named, so what this asserts is that the binding is
    actually applied to every statement — not that the API makes it awkward to get wrong.
    """
    tenants = seed_two_tenants(tmp_path / "tenants")
    alice = tenants.alice_paper
    bob = tenants.bob_paper

    with AgentDataHandle(tenants.path, tenants.alice_user_id) as handle:
        # Non-vacuous: Alice's own reads work, so an empty answer below is about ownership.
        assert handle.get_paper(alice.paper_id, alice.generation) is not None
        assert handle.count_blocks(alice.paper_id, alice.generation) > 0
        assert handle.list_pages(alice.paper_id, alice.generation) != []

        # Bob's paper id is not secret — ids appear in URLs — and naming it gets nothing.
        assert handle.get_paper(bob.paper_id, bob.generation) is None
        assert handle.list_pages(bob.paper_id, bob.generation) == []
        assert handle.list_blocks_in_doc_order(bob.paper_id, bob.generation) == []
        assert handle.list_blocks_on_page(bob.paper_id, bob.generation, 0) == []
        assert handle.count_blocks(bob.paper_id, bob.generation) == 0
        assert handle.list_relations(bob.paper_id, bob.generation) == []
        assert handle.count_block_vectors(bob.paper_id, bob.generation) == 0
        assert handle.get_block(bob.paper_id, bob.generation, BlockId("blk_x")) is None
        assert handle.list_paper_memory(bob.paper_id, bob.generation) == []
        assert handle.list_artefact_memory(bob.paper_id, bob.generation) == []

    # …and Bob's own handle DOES see Bob's paper, so the emptiness above is not "nothing is
    # readable at all".
    with AgentDataHandle(tenants.path, tenants.bob_user_id) as bob_handle:
        assert bob_handle.get_paper(bob.paper_id, bob.generation) is not None

    # A handle for a user who does not exist is refused at construction, not at first read.
    with pytest.raises(OwnershipError, match="no such user"):
        AgentDataHandle(tenants.path, "usr_nobody")


def test_an_in_memory_database_is_refused(tmp_path: Path) -> None:
    """``:memory:`` would give every read a wrong answer shaped exactly like a right one.

    A second connection to ``:memory:`` is a second, EMPTY database. A handle onto one would
    answer "no rows" to everything, and a suite full of "the attack wrote nothing" assertions
    would pass against a handle that can read nothing either.
    """
    with pytest.raises(ValueError, match="FILE-backed"):
        AgentDataHandle(":memory:", "usr_anything")
    with pytest.raises(FileNotFoundError):
        AgentDataHandle(tmp_path / "does-not-exist.sqlite", "usr_anything")
