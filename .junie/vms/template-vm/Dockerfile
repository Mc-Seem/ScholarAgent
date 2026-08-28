FROM registry.jetbrains.team/p/junie-cli/containers/demo-base:2

# Node 24 — the project demands ">=24 <25" (mise pins 24.18.0)
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# socat forwards localhost:8000 inside the VM to the backend on the host;
# the rest are build deps for Theia's native modules (node-pty, keytar, drivelist)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        socat \
        build-essential \
        python3 \
        pkg-config \
        libsecret-1-dev \
        libxkbfile-dev \
    && rm -rf /var/lib/apt/lists/*
