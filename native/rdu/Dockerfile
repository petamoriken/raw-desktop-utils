# Linux build image with libwayland for the X11 + Wayland helper.
FROM rust:1-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends libwayland-dev libasound2-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work/native/rdu
