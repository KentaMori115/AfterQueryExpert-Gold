from cueforge.compiler.plan import compile_production_document
from cueforge.production.build import production_from_mapping
from test_lab.builders.productions import two_cue_chain


def test_two_cue_chain_starts() -> None:
    production, findings = production_from_mapping(two_cue_chain(), "memory")
    assert production is not None
    assert findings == []
    show, compile_findings = compile_production_document(production)
    assert compile_findings == ()
    assert show is not None
    assert show.cue_map()["a"].start_ms == 0
    assert show.cue_map()["b"].start_ms == 50
