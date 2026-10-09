"""Host versions shared by the compatibility modules."""

import os

V2_VERSIONS = (
    [os.environ["V2_HOST_VERSION"]]
    if os.environ.get("V2_HOST_VERSION")
    else ["2.0.3", "2.0.11", "2.0.15", "2.0.18", "2.0.26"]
)
