package com.cliqheart.app

import androidx.navigation.fragment.NavHostFragment
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.isDisplayed
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MessagingUiTest {
    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

    @Test
    fun inboxShowsSearchAndNewMessageActions() {
        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            if (navHost.navController.currentDestination?.id != R.id.mainShellFragment) {
                navHost.navController.navigate(R.id.mainShellFragment)
            }
        }
        onView(withId(R.id.messagesTab)).perform(click())
        onView(withId(R.id.inbox_avatar)).check(matches(isDisplayed()))
        onView(withId(R.id.conversation_search)).check(matches(isDisplayed()))
        onView(withId(R.id.new_message_button)).check(matches(isDisplayed()))
        onView(withId(R.id.conversations_recycler)).check(matches(isDisplayed()))
    }

    @Test
    fun chatComposerAndHeaderRenderWithoutNetworkData() {
        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            if (navHost.navController.currentDestination?.id != R.id.mainShellFragment) {
                navHost.navController.navigate(R.id.mainShellFragment)
            }
            navHost.navController.navigate(
                R.id.chatFragment,
                android.os.Bundle().apply { putString("conversationId", "0123456789abcdef01234567") },
            )
        }
        onView(withId(R.id.chat_back_button)).check(matches(isDisplayed()))
        onView(withId(R.id.chat_avatar)).check(matches(isDisplayed()))
        onView(withId(R.id.message_input)).check(matches(isDisplayed()))
        onView(withId(R.id.send_message_button)).check(matches(isDisplayed()))
    }
}
