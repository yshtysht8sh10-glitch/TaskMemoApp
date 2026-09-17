# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Regression-first development

Follow `docs/TESTING.md` for every behavior change and bug fix.

For a bug fix, the required order is:

1. Add the smallest regression test that reproduces the reported behavior.
2. Run that focused test and confirm it fails for the expected reason.
3. Implement the smallest fix that addresses the identified cause.
4. Run the focused test, related tests, and then the full test suite.
5. Run TypeScript, lint, `git diff --check`, and Web production export when the change can affect the app or Web build.

Do not delete, skip, or weaken a valid test just to make a change pass. If the test's assumption is wrong, correct the test and record why before changing production code.
