from app.import_units import normalize_project_standard_state


def test_normalize_project_standard_state_handles_bool_and_strings():
    assert normalize_project_standard_state(True) == 'true'
    assert normalize_project_standard_state(False) == 'false'
    assert normalize_project_standard_state('true') == 'true'
    assert normalize_project_standard_state('false') == 'false'


def test_normalize_project_standard_state_preserves_multi_state_values():
    assert normalize_project_standard_state('preparation_ac') == 'preparation_ac'
    assert normalize_project_standard_state('complete_ac') == 'complete_ac'
    assert normalize_project_standard_state('cooling_ceilings') == 'cooling_ceilings'


def test_normalize_project_standard_state_handles_empty_values():
    assert normalize_project_standard_state('') is None
    assert normalize_project_standard_state(None) is None
