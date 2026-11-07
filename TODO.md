# TODO

## CI: publish Docker image on release

Status: the `release` workflow is pushed and active (builds
`linux/amd64,linux/arm64` via QEMU and pushes versioned tags plus `latest`
to `duber000/town-builder`), and the `DOCKER_USERNAME`/`DOCKER_PASSWORD`
secrets are set. Remaining step:

1. Publish a GitHub release (or run the workflow manually) — then switch
   the server's `town-builder.container` quadlet to
   `Image=docker.io/duber000/town-builder:latest` with
   `AutoUpdate=registry` (the podman login credentials for `docker.io` are
   already in place for the kibigia user) and restart the unit.

The production host currently runs the ad-hoc locally built image
`localhost/town-builder:go`.
