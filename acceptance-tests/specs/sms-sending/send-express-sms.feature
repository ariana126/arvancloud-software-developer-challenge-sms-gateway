Feature: Send express SMS
  As a registered user
  I want to send an SMS via the express service
  So that I know when it will reach the operator

  Background:
    Given Ariana is a registered user
    And Ariana's account credit is 10000 Rials

  Scenario: Successful express send shows the delivery-time guarantee
    When Ariana sends an express SMS to "09121234567"
    Then the SMS is sent successfully
    And Ariana is shown the guaranteed delivery time to the operator
