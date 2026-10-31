package com.cliqheart.app.core.network

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagingResponseParsingTest {
    @Test
    fun parsesPaginatedConversationsAndUnreadMetadata() {
        val result = Gson().fromJson(
            """
                {
                  "conversations": [{
                    "id": "conversation-id",
                    "participant": {
                      "id": "participant-id",
                      "username": "creator",
                      "displayName": "Creator",
                      "avatarUrl": "https://images.example/avatar.jpg"
                    },
                    "lastMessage": {
                      "text": "Hello",
                      "senderId": "participant-id",
                      "createdAt": "2026-10-31T12:00:00.000Z"
                    },
                    "unreadCount": 3
                  }],
                  "hasMore": true,
                  "nextCursor": "conversation-cursor"
                }
            """.trimIndent(),
            ConversationsResponse::class.java,
        )

        assertEquals(3, result.conversations.single().unreadCount)
        assertEquals("https://images.example/avatar.jpg", result.conversations.single().participant?.avatarUrl)
        assertEquals("participant-id", result.conversations.single().lastMessage?.senderId)
        assertTrue(result.hasMore)
        assertEquals("conversation-cursor", result.nextCursor)
    }

    @Test
    fun parsesServerReceiptStateAndLegacyMessages() {
        val message = Gson().fromJson(
            """
                {
                  "id": "message-id",
                  "senderId": "sender-id",
                  "text": "Hello",
                  "clientMessageId": "client-message-id",
                  "createdAt": "2026-10-31T12:00:00.000Z",
                  "deliveredAt": "2026-10-31T12:00:01.000Z",
                  "readAt": "2026-10-31T12:00:02.000Z"
                }
            """.trimIndent(),
            MessageResponse::class.java,
        )
        val legacy = Gson().fromJson(
            """{"id":"legacy-id","senderId":"sender-id","text":"Earlier message"}""",
            MessageResponse::class.java,
        )

        assertEquals("client-message-id", message.clientMessageId)
        assertEquals("2026-10-31T12:00:01.000Z", message.deliveredAt)
        assertEquals("2026-10-31T12:00:02.000Z", message.readAt)
        assertFalse(message.failed)
        assertEquals("Earlier message", legacy.text)
        assertTrue(legacy.deliveredAt == null)
    }
}
