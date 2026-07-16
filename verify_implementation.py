#!/usr/bin/env python3
"""Verify that all GitProvider methods are implemented in AzureDevOpsProvider."""

import sys
import importlib.util
from pathlib import Path

# Load protocol module
protocol_path = Path("apps/backend/runners/github/providers/protocol.py")
spec = importlib.util.spec_from_file_location("protocol", protocol_path)
protocol = importlib.util.module_from_spec(spec)
spec.loader.exec_module(protocol)

# Load Azure DevOps provider module
provider_path = Path("apps/backend/runners/azure-devops/providers/azure_devops_provider.py")
spec = importlib.util.spec_from_file_location("azure_devops_provider", provider_path)
provider = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provider)

# Get all protocol methods (excluding private)
protocol_methods = set(n for n in dir(protocol.GitProvider) if not n.startswith('_'))

# Get all provider methods (excluding private)
impl_methods = set(n for n in dir(provider.AzureDevOpsProvider) if not n.startswith('_'))

# Find missing methods
missing = protocol_methods - impl_methods

if missing:
    print(f"MISSING: {sorted(missing)}")
    sys.exit(1)
else:
    print("OK - All GitProvider methods are implemented")
    sys.exit(0)
