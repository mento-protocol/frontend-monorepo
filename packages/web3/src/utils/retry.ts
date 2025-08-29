import { logger } from "@/utils/logger";
import { sleep } from "@/utils/timeout";

// If all the tries fail it raises the last thrown exception
export async function retryAsync<T>(
  runner: () => T,
  attempts = 2,
  delay = 1500,
) {
  let saveError;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await runner();
      if (result) return result;
      else throw new Error("Empty result");
    } catch (error) {
      saveError = error;

      // Don't retry if user rejected the transaction
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.toLowerCase().includes("denied") ||
        errorMessage.toLowerCase().includes("rejected")
      ) {
        logger.error(
          `retryAsync: User rejected transaction, not retrying:`,
          error,
        );
        throw error;
      }

      // Only sleep and continue if we have more attempts and it's not the last one
      if (i < attempts - 1) {
        await sleep(delay * (i + 1));
      }

      logger.error(
        `retryAsync: Failed to execute function on attempt #${i + 1}:`,
        error,
      );
    }
  }
  logger.error(`retryAsync: All attempts failed`);
  throw saveError;
}
