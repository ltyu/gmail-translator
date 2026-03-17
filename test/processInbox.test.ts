import { beforeEach, describe, expect, it, vi } from "vitest";
import { processInbox } from "../src/handler.js";
import { EmailMessage, GmailService, ProcessedEmailRepository, TranslationService } from "../src/types.js";

describe("EmailTranslationJob", () => {
  const gmailService: GmailService = {
    getAuthenticatedEmail: vi.fn(),
    listRecentInboxMessages: vi.fn(),
    getMessage: vi.fn(),
    sendReply: vi.fn(),
  };
  const translationService: TranslationService = {
    translateText: vi.fn(),
  };
  const processedEmailRepository: ProcessedEmailRepository = {
    isProcessed: vi.fn(),
    markProcessed: vi.fn(),
  };
  const logger = { log: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gmailService.getAuthenticatedEmail).mockResolvedValue("me@example.com");
    vi.mocked(gmailService.listRecentInboxMessages).mockResolvedValue([]);
  });

  it("skips already processed messages", async () => {
    vi.mocked(gmailService.listRecentInboxMessages).mockResolvedValue([{ id: "1" }]);
    vi.mocked(processedEmailRepository.isProcessed).mockResolvedValue(true);

    await processInbox(gmailService, translationService, processedEmailRepository, logger);

    expect(gmailService.getMessage).not.toHaveBeenCalled();
    expect(processedEmailRepository.markProcessed).not.toHaveBeenCalled();
  });

  it("marks empty-body messages as processed without translating", async () => {
    vi.mocked(gmailService.listRecentInboxMessages).mockResolvedValue([{ id: "1" }]);
    vi.mocked(processedEmailRepository.isProcessed).mockResolvedValue(false);
    vi.mocked(gmailService.getMessage).mockResolvedValue(makeMessage({ bodyText: "   " }));

    await processInbox(gmailService, translationService, processedEmailRepository, logger);

    expect(translationService.translateText).not.toHaveBeenCalled();
    expect(gmailService.sendReply).not.toHaveBeenCalled();
    expect(processedEmailRepository.markProcessed).toHaveBeenCalledWith("1");
  });

  it("translates, replies, and marks processed", async () => {
    vi.mocked(gmailService.listRecentInboxMessages).mockResolvedValue([{ id: "1" }]);
    vi.mocked(processedEmailRepository.isProcessed).mockResolvedValue(false);
    vi.mocked(gmailService.getMessage).mockResolvedValue(makeMessage());
    vi.mocked(translationService.translateText).mockResolvedValue("translated");

    await processInbox(gmailService, translationService, processedEmailRepository, logger);

    expect(translationService.translateText).toHaveBeenCalledWith("Body text");
    expect(gmailService.sendReply).toHaveBeenCalledWith({
      to: "me@example.com",
      subject: "Hello",
      messageId: "<id>",
      threadId: "thread-1",
      translation: "translated",
      originalText: "Body text",
    });
    expect(processedEmailRepository.markProcessed).toHaveBeenCalledWith("1");
  });
});

function makeMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: "1",
    threadId: "thread-1",
    subject: "Hello",
    from: "sender@example.com",
    messageId: "<id>",
    bodyText: "Body text",
    ...overrides,
  };
}
