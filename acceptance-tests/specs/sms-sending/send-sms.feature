Feature: Send SMS
  As a registered user
  I want to send an SMS to any number
  So that I can reach my contacts

  Background:
    Given Ariana is a registered user

  Scenario: Successful send with sufficient credit
    Given Ariana's account credit is 10000 Rials
    When Ariana sends an SMS to "09121234567"
    Then the SMS is sent successfully
    And the cost of the SMS is deducted from Ariana's account credit

  Scenario: Using all remaining credit to send an SMS
    Given Ariana's account credit is exactly the cost of one SMS
    When Ariana sends an SMS to "09121234567"
    Then the SMS is sent successfully
    And Ariana's account credit becomes 0

  Scenario: Two sends at the same moment cannot both spend the same credit
    Given Ariana's account credit is exactly the cost of one SMS
    When Ariana sends two SMS to "09121234567" at the same moment
    Then exactly one of the sends succeeds
    And the other is rejected due to insufficient credit
    And Ariana's account credit becomes 0

  Scenario: Rejecting a send due to insufficient credit
    Given Ariana's account credit is 0
    When Ariana sends an SMS to "09121234567"
    Then the send is rejected due to insufficient credit
    And no cost is deducted from Ariana's account credit
