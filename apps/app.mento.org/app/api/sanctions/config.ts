// TEMPORARY: Chainalysis's sanctions API is down (it returns a 500 error body
// with HTTP 200), which blocks every wallet. While true, a failed lookup lets
// the user through; addresses Chainalysis does identify are still blocked.
// Set back to false (or revert this commit) once Chainalysis recovers.
export const SANCTIONS_CHECK_FAIL_OPEN = true;
