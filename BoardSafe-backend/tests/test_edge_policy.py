from edge.agent import inside_polygon,validate_roi

def test_edge_roi_geometry():
    roi=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]]
    assert validate_roi(roi)==roi
    assert inside_polygon(.5,.5,roi)
    assert not inside_polygon(.05,.05,roi)

def test_roi_rejects_out_of_range():
    import pytest
    with pytest.raises(ValueError):validate_roi([[0,0],[2,0],[1,1]])
