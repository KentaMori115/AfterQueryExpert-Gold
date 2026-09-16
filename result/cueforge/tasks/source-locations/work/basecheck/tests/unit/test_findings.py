from cueforge.findings import Finding, Severity, SourceRef, sort_findings


def test_sort_severity_before_path() -> None:
    later_error = Finding("CF1002", Severity.ERROR, "b", source=SourceRef("z.yaml", 2, 1))
    warning = Finding("CF1001", Severity.WARNING, "a", source=SourceRef("a.yaml", 1, 1))
    ordered = sort_findings([warning, later_error])
    assert ordered[0].severity == Severity.ERROR
    assert ordered[1].severity == Severity.WARNING


def test_sort_by_path_line_column_then_code() -> None:
    a = Finding("CF1002", Severity.ERROR, "m", source=SourceRef("b.yaml", 1, 1))
    b = Finding("CF1001", Severity.ERROR, "m", source=SourceRef("a.yaml", 9, 1))
    c = Finding("CF1001", Severity.ERROR, "m", source=SourceRef("a.yaml", 1, 3))
    d = Finding("CF1001", Severity.ERROR, "m", source=SourceRef("a.yaml", 1, 1))
    ordered = sort_findings([a, b, c, d])
    assert [item.source.as_tuple() if item.source else () for item in ordered] == [
        ("a.yaml", 1, 1),
        ("a.yaml", 1, 3),
        ("a.yaml", 9, 1),
        ("b.yaml", 1, 1),
    ]


def test_sort_subject_is_stable() -> None:
    a = Finding("CF1001", Severity.ERROR, "m", subject_kind="cue", subject_id="b")
    b = Finding("CF1001", Severity.ERROR, "m", subject_kind="cue", subject_id="a")
    ordered = sort_findings([a, b])
    assert [item.subject_id for item in ordered] == ["a", "b"]


def test_witness_defaults_to_empty_mapping() -> None:
    finding = Finding("CF1001", Severity.ERROR, "m")
    assert dict(finding.witness) == {}


def test_source_ref_is_frozen() -> None:
    ref = SourceRef("show.yaml", 3, 2)
    assert ref.path == "show.yaml"
    assert ref.line == 3
    assert ref.column == 2
