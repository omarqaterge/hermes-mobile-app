- **The app connects as soon as Hermes has started.** When opening the app has to start Hermes too, the app could
  notice a ready Hermes up to 15 seconds late; the Android shell now tells it the moment Hermes answers. Tested in
  browser and unit tests; not yet measured on a phone.
