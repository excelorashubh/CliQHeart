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
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
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
            val navigation = findMainShell(activity).requireView()
                .findViewById<BottomNavigationView>(R.id.bottom_navigation)
            navigation.selectedItemId = R.id.homeTab
            navigation.selectedItemId = R.id.profileTab
        }

        assertProfileRendered()
    }

    @Test
    fun profileHomeProfileRendersOneProfileFragment() {
        openMainShell()

        activityRule.scenario.onActivity { activity ->
            val navigation = findMainShell(activity).requireView()
                .findViewById<BottomNavigationView>(R.id.bottom_navigation)
            navigation.selectedItemId = R.id.profileTab
            navigation.selectedItemId = R.id.homeTab
            navigation.selectedItemId = R.id.profileTab
        }

        assertProfileRendered()
    }

    @Test
    fun rapidTabSwitchingDoesNotCreateDuplicateFragments() {
        openMainShell()

        activityRule.scenario.onActivity { activity ->
            val navigation = findMainShell(activity).requireView()
                .findViewById<BottomNavigationView>(R.id.bottom_navigation)
            navigation.selectedItemId = R.id.profileTab
            navigation.selectedItemId = R.id.messagesTab
            navigation.selectedItemId = R.id.searchTab
            navigation.selectedItemId = R.id.homeTab
            navigation.selectedItemId = R.id.profileTab
        }

        assertProfileRendered()
    }

    @Test
    fun selectedProfileIsRestoredAfterActivityRecreation() {
        openMainShell()
        activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        activityRule.scenario.onActivity { activity ->
            findMainShell(activity).requireView()
                .findViewById<BottomNavigationView>(R.id.bottom_navigation)
                .selectedItemId = R.id.profileTab
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
            val navigation = shell.requireView().findViewById<BottomNavigationView>(
                R.id.bottom_navigation,
            )

            assertTrue(navigation.isShown)
            assertTrue(
                navigation.height >=
                    (64 * navigation.resources.displayMetrics.density).toInt(),
            )
            assertEquals(5, navigation.menu.size())
            val profileItem = navigation.menu.findItem(R.id.profileTab)
            assertNotNull(profileItem)
            assertTrue(profileItem.isVisible)
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

            for (selectedItemId in listOf(R.id.homeTab, R.id.profileTab)) {
                navigation.selectedItemId = selectedItemId
                shell.childFragmentManager.executePendingTransactions()
                val profileItemView = navigation.findViewById<View>(R.id.profileTab)
                assertNotNull(profileItemView)
                assertTrue(profileItemView.isClickable)
                val profileIcon = findImageView(profileItemView)
                assertNotNull(profileIcon)
                assertEquals(View.VISIBLE, profileIcon!!.visibility)
                assertNotNull(profileIcon.drawable)
                assertTrue(profileIcon.width > 0)
                assertTrue(profileIcon.height > 0)
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
            assertEquals(
                R.id.profileTab,
                shell.requireView()
                    .findViewById<BottomNavigationView>(R.id.bottom_navigation)
                    .selectedItemId,
            )
        }
    }

    private fun findImageView(view: View): ImageView? {
        if (view is ImageView) return view
        if (view !is ViewGroup) return null
        for (index in 0 until view.childCount) {
            findImageView(view.getChildAt(index))?.let { return it }
        }
        return null
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
