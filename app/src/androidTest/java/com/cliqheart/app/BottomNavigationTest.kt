package com.cliqheart.app

import androidx.fragment.app.Fragment
import androidx.lifecycle.Lifecycle
import androidx.navigation.fragment.NavHostFragment
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.Espresso.pressBack
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.espresso.matcher.ViewMatchers.isDisplayed
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.cliqheart.app.feature.home.MainShellFragment
import com.cliqheart.app.feature.home.tabs.ActivityFragment
import com.cliqheart.app.feature.home.tabs.CreatePostFragment
import com.cliqheart.app.feature.home.tabs.DiscoverFragment
import com.cliqheart.app.feature.home.tabs.HomeFeedFragment
import com.cliqheart.app.feature.home.tabs.MessagesFragment
import com.cliqheart.app.feature.home.tabs.ProfileFragment
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
    fun profileRendersOnFirstNavigationWithoutSwitchingTabs() {
        openMainShell()

        activityRule.scenario.onActivity { activity ->
            val shell = findMainShell(activity)
            assertTrue(
                shell.childFragmentManager.fragments.none { it is ProfileFragment },
            )
        }
        onView(withId(R.id.profileTab)).perform(click())
        onView(withId(R.id.profile_username_title)).check(matches(isDisplayed()))
        onView(withId(R.id.profile_avatar)).check(matches(isDisplayed()))

        assertProfileRendered()
    }

    @Test
    fun homeToProfileRendersProfile() {
        openMainShell()

        activityRule.scenario.onActivity { activity ->
            selectTab(findMainShell(activity), R.id.homeTab)
            selectTab(findMainShell(activity), R.id.profileTab)
        }

        assertProfileRendered()
    }

    @Test
    fun profileHomeProfileRendersOneProfileFragment() {
        openMainShell()

        activityRule.scenario.onActivity { activity ->
            val shell = findMainShell(activity)
            selectTab(shell, R.id.profileTab)
            selectTab(shell, R.id.homeTab)
            selectTab(shell, R.id.profileTab)
        }

        assertProfileRendered()
    }

    @Test
    fun rapidTabSwitchingDoesNotCreateDuplicateFragments() {
        openMainShell()

        activityRule.scenario.onActivity { activity ->
            val shell = findMainShell(activity)
            listOf(
                R.id.profileTab,
                R.id.messagesTab,
                R.id.searchTab,
                R.id.reelsTab,
                R.id.homeTab,
                R.id.profileTab,
            ).forEach { selectTab(shell, it) }
        }

        assertProfileRendered()
    }

    @Test
    fun selectedProfileIsRestoredAfterActivityRecreation() {
        openMainShell()
        activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        activityRule.scenario.onActivity { activity ->
            selectTab(findMainShell(activity), R.id.profileTab)
        }
        assertProfileRendered()

        activityRule.scenario.recreate()

        assertProfileRendered()
    }

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
            val navigation = shell.requireView().findViewById<LinearLayout>(
                R.id.bottom_navigation,
            )
            val items = navigation.findViewById<LinearLayout>(R.id.navigation_items)

            assertTrue(navigation.isShown)
            assertTrue(
                navigation.height >=
                    (64 * navigation.resources.displayMetrics.density).toInt(),
            )
            assertEquals(5, items.childCount)
            assertEquals(
                (64 * items.resources.displayMetrics.density).toInt(),
                items.height,
            )
            val profileItem = items.findViewById<View>(R.id.profileTab)
            assertNotNull(profileItem)
            assertTrue(profileItem.isShown)
            assertTrue(profileItem.isEnabled)
            assertEquals(
                0,
                activity.resources.getIdentifier(
                    "btn_header_messages",
                    "id",
                    activity.packageName,
                ),
            )
            shell.updateMessagesUnreadCount(7)
            val messagesItem = items.findViewById<View>(R.id.messagesTab)
            val messagesBadge = messagesItem.findViewById<TextView>(R.id.navigation_badge)
            assertEquals("7", messagesBadge.text)
            assertEquals(View.VISIBLE, messagesBadge.visibility)
            shell.updateMessagesUnreadCount(0)
            assertFalse(messagesBadge.isShown)

            val destinations = listOf(
                Triple(R.id.homeTab, R.string.home, HomeFeedFragment::class.java),
                Triple(R.id.reelsTab, R.string.reels, HomeFeedFragment::class.java),
                Triple(R.id.messagesTab, R.string.messages, MessagesFragment::class.java),
                Triple(R.id.searchTab, R.string.search, DiscoverFragment::class.java),
                Triple(R.id.profileTab, R.string.profile, ProfileFragment::class.java),
            )

            for ((itemId, titleRes, fragmentClass) in destinations) {
                val item = items.findViewById<View>(itemId)
                assertNotNull(item)
                assertEquals(activity.getString(titleRes), item.contentDescription)
                assertTrue(item.isClickable)
                assertTrue(item.isFocusable)
                assertTrue(
                    item.width >= (48 * item.resources.displayMetrics.density).toInt(),
                )

                selectTab(shell, itemId)
                shell.childFragmentManager.executePendingTransactions()
                val currentFragment: Fragment? = shell.childFragmentManager.fragments
                    .firstOrNull { it.isVisible && it.id == R.id.tab_container }
                assertEquals(fragmentClass, currentFragment!!::class.java)
                assertTrue(item.isSelected)
                assertEquals(
                    activity.getString(titleRes),
                    item.findViewById<TextView>(R.id.navigation_label).text,
                )
                val icon = item.findViewById<ImageView>(R.id.navigation_icon)
                assertEquals(
                    (24 * icon.resources.displayMetrics.density).toInt(),
                    icon.layoutParams.width,
                )
                assertNotNull(icon.drawable)
            }

            for (selectedItemId in listOf(R.id.homeTab, R.id.profileTab)) {
                selectTab(shell, selectedItemId)
                shell.childFragmentManager.executePendingTransactions()
                val profileItemView = items.findViewById<View>(R.id.profileTab)
                assertNotNull(profileItemView)
                assertTrue(profileItemView.isClickable)
                val avatar = profileItemView.findViewById<ImageView>(R.id.navigation_avatar)
                assertEquals(ImageView.ScaleType.CENTER_CROP, avatar.scaleType)
                val avatarFrame = profileItemView.findViewById<View>(R.id.navigation_avatar_frame)
                assertEquals(
                    (29 * avatar.resources.displayMetrics.density).toInt(),
                    avatarFrame.layoutParams.width,
                )
                val profileIcon = profileItemView.findViewById<ImageView>(R.id.navigation_icon)
                assertNotNull(profileIcon.drawable)
                if (avatarFrame.visibility == View.VISIBLE) {
                    assertEquals(View.GONE, profileIcon.visibility)
                    assertTrue(avatar.width > 0)
                    assertTrue(avatar.height > 0)
                } else {
                    assertEquals(View.VISIBLE, profileIcon.visibility)
                    assertTrue(profileIcon.width > 0)
                    assertTrue(profileIcon.height > 0)
                }
            }

        }
    }

    private fun openMainShell() {
        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            navHost.navController.navigate(R.id.mainShellFragment)
        }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
    }

    private fun findMainShell(activity: MainActivity): MainShellFragment {
        val navHost = activity.supportFragmentManager
            .findFragmentById(R.id.nav_host) as NavHostFragment
        return navHost.childFragmentManager.fragments
            .filterIsInstance<MainShellFragment>()
            .single()
    }

    private fun assertProfileRendered() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        activityRule.scenario.onActivity { activity ->
            findMainShell(activity).childFragmentManager.executePendingTransactions()
        }
        instrumentation.waitForIdleSync()

        activityRule.scenario.onActivity { activity ->
            val shell = findMainShell(activity)
            val manager = shell.childFragmentManager
            val profiles = manager.fragments.filterIsInstance<ProfileFragment>()
            assertEquals(1, profiles.size)
            assertEquals(1, manager.fragments.count { it.tag == "profile" })
            val profile = profiles.single()
            assertTrue(profile.isVisible)
            val root = requireNotNull(profile.view)
            assertEquals(View.VISIBLE, root.visibility)
            assertTrue(root.isAttachedToWindow)
            assertTrue(root.isShown)
            assertTrue(root.width > 0)
            assertTrue(root.height > 0)
            val visibleBounds = android.graphics.Rect()
            assertTrue(root.getGlobalVisibleRect(visibleBounds))
            assertTrue(visibleBounds.width() > 0)
            assertTrue(visibleBounds.height() > 0)

            val username = root.findViewById<TextView>(R.id.profile_username_title)
            assertNotNull(username)
            assertEquals(View.VISIBLE, username.visibility)
            val avatar = root.findViewById<ImageView>(R.id.profile_avatar)
            assertNotNull(avatar)
            assertEquals(View.VISIBLE, avatar.visibility)
            assertNotNull(avatar.drawable)
            for (statId in listOf(
                R.id.stat_posts_count,
                R.id.stat_followers_count,
                R.id.stat_following_count,
            )) {
                val statistic = root.findViewById<TextView>(statId)
                assertNotNull(statistic)
                assertEquals(View.VISIBLE, statistic.visibility)
                assertTrue(statistic.text.isNotEmpty())
            }
            assertEquals(
                View.VISIBLE,
                root.findViewById<View>(R.id.btn_edit_profile).visibility,
            )
            assertEquals(
                View.VISIBLE,
                root.findViewById<View>(R.id.btn_share_profile).visibility,
            )
            assertTrue(shell.requireView().findViewById<View>(R.id.profileTab).isSelected)
        }
    }

    private fun selectTab(shell: MainShellFragment, tabId: Int) {
        val item = shell.requireView().findViewById<View>(tabId)
        assertNotNull(item)
        check(item.performClick()) { "Navigation tab $tabId did not handle its click." }
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
            selectTab(shell, R.id.homeTab)
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
            val selectedItem = shell.requireView().findViewById<View>(R.id.homeTab)
            assertTrue(selectedItem.isSelected)
            val currentFragment: Fragment? = shell.childFragmentManager.fragments
                .firstOrNull { it.isVisible && it.id == R.id.tab_container }
            assertEquals(HomeFeedFragment::class.java, currentFragment!!::class.java)
        }
    }
}
