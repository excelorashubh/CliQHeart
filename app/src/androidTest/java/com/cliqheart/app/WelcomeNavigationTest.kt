package com.cliqheart.app

import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.isDisplayed
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WelcomeNavigationTest {
    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

    @Test
    fun signUpButtonOpensRegistrationPlaceholder() {
        onView(withId(R.id.signup_button)).perform(click())
        onView(withText(R.string.signup_title)).check(matches(isDisplayed()))
    }

    @Test
    fun logInButtonOpensLoginPlaceholder() {
        onView(withId(R.id.login_button)).perform(click())
        onView(withText(R.string.login_title)).check(matches(isDisplayed()))
    }
}
