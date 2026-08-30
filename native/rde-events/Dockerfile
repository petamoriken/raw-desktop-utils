# Build the Linux cdylib. Used from macOS/Windows via Docker Desktop.
#
#   docker build --platform linux/arm64 -f native/rde-events/Dockerfile \
#     --output native/prebuilt .
FROM rust:1-bookworm AS build
WORKDIR /src
COPY native/rde-events /src
RUN cargo build --release

FROM scratch AS export
COPY --from=build /src/target/release/librde_events.so /librde_events.so
