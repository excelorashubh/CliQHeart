package com.cliqheart.app

import androidx.fragment.app.Fragment
import androidx.navigation.fragment.NavHostFragment
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.Espresso.pressBack
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.cliqheart.app.feature.home.MainShellFragment
import com.cliqheart.app.feature.home.tabs.ActivityFragment
import com.cliqheart.app.feature.home.tabs.CreatePostFragment
import com.cliqheart.app.feature.home.tabs.DiscoverFragment
import com.cliqheart.app.feature.home.tabs.HomeFeedFragment
import com.cliqheart.app.feature.home.tabs.MessagesFragment
import com.cliqheart.app.feature.home.tabs.ProfileFragment
import com.google.android.material.bottomnavigation.BottomNavigationView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BottomNavigationTest {
    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

    @Test
    fun allNavigationItemsAreVisibleAndOpenTheirTabs() {
        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            navHost.navController.navigate(R.id.mainShellFragment)
        }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()

        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            val shell = navHost.childFragmentManager.fragments
                .filterIsInstance<MainShellFragment>()
                .single()
            shell.childFragmentManager.executePendingTransactions()
            val navigation = shell.requireView().findViewById<BottomNavigationView>(
                R.id.bottom_navigation,
            )

            assertTrue(navigation.isShown)
            assertTrue(
                navigation.height >=
                    (64 * navigation.resources.displayMetrics.density).toInt(),
            )
            assertEquals(5, navigation.menu.size())
            assertEquals(
                0,
                activity.resources.getIdentifier(
                    "btn_header_messages",
                    "id",
                    activity.packageName,
                ),
            )
            shell.updateMessagesUnreadCount(7)
            assertEquals(7, navigation.getBadge(R.id.messagesTab)?.number)
            shell.updateMessagesUnreadCount(0)
            assertFalse(navigation.getBadge(R.id.messagesTab)?.isVisible ?: false)

            val destinations = listOf(
                Triple(R.id.homeTab, R.string.home, HomeFeedFragment::class.java),
                Triple(R.id.reelsTab, R.string.reels, HomeFeedFragment::class.java),
                Triple(R.id.messagesTab, R.string.messages, MessagesFragment::class.java),
                Triple(R.id.searchTab, R.string.search, DiscoverFragment::class.java),
                Triple(R.id.profileTab, R.string.profile, ProfileFragment::class.java),
            )

            for ((itemId, titleRes, fragmentClass) in destinations) {
                val item = navigation.menu.findItem(itemId)
                assertNotNull(item)
                assertEquals(activity.getString(titleRes), item.title)
                assertNotNull(item.icon)

                navigation.selectedItemId = itemId
                shell.childFragmentManager.executePendingTransactions()
                val currentFragment: Fragment? = shell.childFragmentManager.fragments
                    .firstOrNull { it.isVisible && it.id == R.id.tab_container }
                assertEquals(fragmentClass, currentFragment!!::class.java)
                assertEquals(itemId, navigation.selectedItemId)
            }
        }
    }

    @Test
    fun headerCreateAndNotificationsOpenExistingScreensAndBackRestoresTab() {
        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            navHost.navController.navigate(R.id.mainShellFragment)
        }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()

        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            val shell = navHost.childFragmentManager.fragments
                .filterIsInstance<MainShellFragment>()
                .single()
            shell.childFragmentManager.executePendingTransactions()
            val navigation = shell.requireView().findViewById<BottomNavigationView>(
                R.id.bottom_navigation,
            )
            navigation.selectedItemId = R.id.homeTab
        }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()

        onView(withId(R.id.btn_header_create)).perform(click())
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            val shell = navHost.childFragmentManager.fragments
                .filterIsInstance<MainShellFragment>()
                .single()
            assertTrue(
                shell.childFragmentManager.fragments.any {
                    it is CreatePostFragment && it.isVisible
                },
            )
        }

        pressBack()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        onView(withId(R.id.btn_header_notifications)).perform(click())
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            val shell = navHost.childFragmentManager.fragments
                .filterIsInstance<MainShellFragment>()
                .single()
            assertTrue(
                shell.childFragmentManager.fragments.any {
                    it is ActivityFragment && it.isVisible
                },
            )
        }

        pressBack()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            val shell = navHost.childFragmentManager.fragments
                .filterIsInstance<MainShellFragment>()
                .single()
            val navigation = shell.requireView().findViewById<BottomNavigationView>(
                R.id.bottom_navigation,
            )
            assertEquals(R.id.homeTab, navigation.selectedItemId)
            val currentFragment: Fragment? = shell.childFragmentManager.fragments
                .firstOrNull { it.isVisible && it.id == R.id.tab_container }
            assertEquals(HomeFeedFragment::class.java, currentFragment!!::class.java)
        }
    }
}
