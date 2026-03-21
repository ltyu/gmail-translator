import { beforeEach, describe, expect, it, vi } from "vitest";
import { processActiveConnections, processInbox } from "./handler.js";
import {
  EmailMessage,
  IGmailConnectionRepository,
  IGmailTokenEncryptionService,
  IGmailService,
  IProcessedEmailRepository,
  ITranslationService,
} from "./types.js";

describe("EmailTranslationJob", () => {
  const gmailService: IGmailService = {
    getAuthenticatedEmail: vi.fn(),
    listRecentInboxMessages: vi.fn(),
    getMessage: vi.fn(),
    sendReply: vi.fn(),
  };
  const translationService: ITranslationService = {
    translateText: vi.fn(),
  };
  const processedEmailRepository: IProcessedEmailRepository = {
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

  it("logs only opaque message identifiers", async () => {
    vi.mocked(gmailService.listRecentInboxMessages).mockResolvedValue([{ id: "1" }]);
    vi.mocked(processedEmailRepository.isProcessed).mockResolvedValue(false);
    vi.mocked(gmailService.getMessage).mockResolvedValue(
      makeMessage({
        subject: "Payroll update",
        from: "finance@example.com",
      }),
    );
    vi.mocked(translationService.translateText).mockResolvedValue("translated");

    await processInbox(gmailService, translationService, processedEmailRepository, logger);

    expect(logger.log).toHaveBeenCalledWith("Processing message: 1");
    expect(logger.log).toHaveBeenCalledWith("Replied with translation for message: 1");
    expect(logger.log).not.toHaveBeenCalledWith(expect.stringContaining("Payroll update"));
    expect(logger.log).not.toHaveBeenCalledWith(expect.stringContaining("finance@example.com"));
  });
});

describe("processActiveConnections", () => {
  it("processes each active connection with a scoped processed-email key", async () => {
    const gmailConnectionRepository: IGmailConnectionRepository = {
      upsertPrimary: vi.fn(),
      loadPrimaryByUserId: vi.fn(),
      listActive: vi.fn(),
      markRevoked: vi.fn(),
      markError: vi.fn(),
      clearRefreshToken: vi.fn(),
      removePrimary: vi.fn(),
    };
    const tokenEncryptionService: IGmailTokenEncryptionService = {
      encryptRefreshToken: vi.fn(),
      decryptRefreshToken: vi.fn().mockResolvedValue("refresh-token"),
    };
  const translationService: ITranslationService = {
      translateText: vi.fn().mockResolvedValue("translated"),
    };
  const processedEmailRepository: IProcessedEmailRepository = {
      isProcessed: vi.fn().mockResolvedValue(false),
      markProcessed: vi.fn(),
    };

  const gmailService: IGmailService = {
      getAuthenticatedEmail: vi.fn().mockResolvedValue("me@example.com"),
      listRecentInboxMessages: vi.fn().mockResolvedValue([{ id: "msg-1" }]),
      getMessage: vi.fn().mockResolvedValue(makeMessage({ id: "msg-1" })),
      sendReply: vi.fn(),
    };

    await processActiveConnections(
      [
        {
          userId: "user-123",
          connectionId: "primary",
          status: "active",
          googleSub: "google-sub-123",
          encryptedRefreshToken: "ciphertext",
          createdAt: "2026-03-17T10:00:00.000Z",
          updatedAt: "2026-03-17T10:00:00.000Z",
        },
      ],
      gmailConnectionRepository,
      tokenEncryptionService,
      { gmailOAuthClientId: "client-id", gmailOAuthClientSecret: "client-secret" },
      translationService,
      processedEmailRepository,
      { log: vi.fn() },
      () => gmailService,
    );

    expect(tokenEncryptionService.decryptRefreshToken).toHaveBeenCalledWith("ciphertext", {
      userId: "user-123",
      connectionId: "primary",
    });
    expect(processedEmailRepository.isProcessed).toHaveBeenCalledWith("user-123:msg-1");
    expect(processedEmailRepository.markProcessed).toHaveBeenCalledWith("user-123:msg-1");
    expect(gmailConnectionRepository.markError).not.toHaveBeenCalled();
  });

  it("marks the connection as error after a permanent auth failure", async () => {
    const gmailConnectionRepository: IGmailConnectionRepository = {
      upsertPrimary: vi.fn(),
      loadPrimaryByUserId: vi.fn(),
      listActive: vi.fn(),
      markRevoked: vi.fn(),
      markError: vi.fn().mockResolvedValue(undefined),
      clearRefreshToken: vi.fn(),
      removePrimary: vi.fn(),
    };
    const tokenEncryptionService: IGmailTokenEncryptionService = {
      encryptRefreshToken: vi.fn(),
      decryptRefreshToken: vi.fn().mockRejectedValue(new Error("invalid_grant")),
    };

    await processActiveConnections(
      [
        {
          userId: "user-123",
          connectionId: "primary",
          status: "active",
          googleSub: "google-sub-123",
          encryptedRefreshToken: "ciphertext",
          createdAt: "2026-03-17T10:00:00.000Z",
          updatedAt: "2026-03-17T10:00:00.000Z",
        },
      ],
      gmailConnectionRepository,
      tokenEncryptionService,
      { gmailOAuthClientId: "client-id", gmailOAuthClientSecret: "client-secret" },
      { translateText: vi.fn() },
      { isProcessed: vi.fn(), markProcessed: vi.fn() },
      { log: vi.fn() },
      () => gmailServiceThatShouldNotBeUsed(),
    );

    expect(gmailConnectionRepository.markError).toHaveBeenCalledTimes(1);
    expect(gmailConnectionRepository.markError).toHaveBeenCalledWith(
      "user-123",
      expect.any(String),
    );
  });
});

function gmailServiceThatShouldNotBeUsed(): IGmailService {
  throw new Error("createGmailService should not be called");
}

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
