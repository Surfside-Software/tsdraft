# Contributing

tsdraft is developed in a private repository and published here. Each change
arrives as a commit on the `export` branch, with a pull request from that branch
to `main`. CI runs on the pull request, which is merged with squash.

- Issues are welcome here.
- Pull requests are welcome too, but they are not merged here. An accepted
  change is made in the development repository, with you credited as a
  co-author, and arrives through the next export pull request.
- Nothing is pushed to `export` or `main` by hand. The next export would replace
  a change there that did not come from it.

Releases are published from this repository. A GitHub release tagged
`v<version>`, on the commit that carries that version, runs the Release
workflow, which publishes to npm through trusted publishing.
